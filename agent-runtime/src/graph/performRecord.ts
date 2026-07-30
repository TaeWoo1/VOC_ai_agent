/**
 * The "record approval result" step, shared by the graph's `record` node and the
 * durable restart-resume path so both behave identically.
 *
 * It is **idempotent by construction**, which is what makes double-resume and
 * process-restart safe:
 *  - `propose` (OPEN → PROPOSED) is an idempotent replay once a proposal exists;
 *  - the draft is saved only if no identical head draft already exists — a re-run finds
 *    the head it wrote last time and reuses that fingerprint instead of saving a
 *    duplicate (and so never hits the PROPOSED-only save guard after the item advanced);
 *  - `confirm-publish` carries a deterministic `commandId`, so the backend treats a
 *    re-run as a replay (no second approval bind, no duplicate audit).
 *
 * It never sends an external reply: the only outbound call is confirm-publish, which is
 * fail-closed at the backend. On reject it writes nothing at all.
 */
import type { ToolRegistry } from "../tools/ToolRegistry";
import { TOOL } from "../tools/inquiryTools";
import type { InquiryDetail, ProposalResult, PublishStatusView, ReplyDraftView } from "../spring/types";
import type { RunOutcome } from "../state/AgentState";
import { log } from "../log";

/** Deterministic idempotency key for the approval, stable across a thread's resumes. */
export function approvalCommandId(threadId: string, workItemId: string): string {
  return `agent:${threadId}:approve:${workItemId}`;
}

export interface RecordInput {
  readonly threadId: string;
  readonly workItemId: string;
  readonly approved: boolean;
  /** Final reply content (human edits already applied), used only when approved. */
  readonly title: string;
  readonly comments: string;
  /** Phase to report on a rejection outcome (sanitized). */
  readonly rejectPhase: string | null;
}

export async function performRecord(registry: ToolRegistry, input: RecordInput): Promise<RunOutcome> {
  const { threadId, workItemId } = input;

  if (!input.approved) {
    // Nothing is written to the backend on reject; the item is left exactly as it was
    // (OPEN, since no mutation happens before the checkpoint) and resurfaces next run.
    log("inquiry_record_rejected", { workItemId: workItemId.slice(0, 8) });
    return {
      recorded: true,
      decision: "REJECTED",
      workItemId,
      phase: input.rejectPhase,
      executionStatus: null,
      category: null,
      approvedFingerprint: null,
      externalSendAttempted: false,
      note: "operator declined; item left OPEN, recorded in orchestration trail only (no backend write)",
    };
  }

  // OPEN -> PROPOSED (idempotent replay if already proposed).
  const proposal = await registry.invoke<ProposalResult>(TOOL.PROPOSE_REPLY, { workItemId });
  log("inquiry_propose", { phase: proposal.phase, category: proposal.proposal.summaryCategory });

  // Reuse an identical head draft if one already exists (idempotent re-run); otherwise
  // save a new version from the current head.
  const detail = await registry.invoke<InquiryDetail>(TOOL.GET_DETAIL, { workItemId });
  const head = detail.draft;
  let fingerprint: string;
  let version: number;
  if (head && head.title === input.title && head.comments === input.comments) {
    fingerprint = head.contentFingerprint;
    version = head.version;
    log("inquiry_draft_reused", { version });
  } else {
    const draft = await registry.invoke<ReplyDraftView>(TOOL.SAVE_DRAFT, {
      workItemId,
      title: input.title,
      comments: input.comments,
      baseVersion: head ? head.version : 0,
    });
    fingerprint = draft.contentFingerprint;
    version = draft.version;
    log("inquiry_draft_saved", { version });
  }

  const commandId = approvalCommandId(threadId, workItemId);
  const status = await registry.invoke<PublishStatusView>(TOOL.RECORD_APPROVAL, {
    workItemId,
    commandId,
    expectedFingerprint: fingerprint,
  });
  log("inquiry_record_approved", {
    phase: status.phase,
    executionStatus: status.executionStatus,
    category: status.category,
    draftVersion: version,
  });

  return {
    recorded: true,
    decision: "APPROVED",
    workItemId,
    phase: status.phase,
    executionStatus: status.executionStatus,
    category: status.category,
    approvedFingerprint: status.approvedFingerprint,
    externalSendAttempted: false,
  };
}
