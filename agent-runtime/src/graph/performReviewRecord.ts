/**
 * The "record approved draft version + prepare guided reply session" step, shared by the
 * review graph's `record` node and the durable restart-resume path so both behave
 * identically.
 *
 * It is **idempotent by construction** for the approve path:
 *  - the approval carries a deterministic `commandId`, so the backend treats a re-run as a
 *    replay (no second bind, no duplicate audit row);
 *  - the draft version was already saved BEFORE the checkpoint, so approval binds to the
 *    exact same version+fingerprint on every resume ("resume with the SAME draft version").
 *
 * The guided-session mint is NOT idempotent at the backend (each call mints a fresh
 * single-use ref), so mint-once across a double/restart resume is guaranteed one level up,
 * by the runtime's DONE-snapshot guard: a completed run replays its stored outcome and never
 * re-enters this step. Within a single call the mint happens exactly once.
 *
 * It never sends an external reply — there is no send tool and no send endpoint. The most it
 * does is mint a ref for a human-performed guided post. On reject it writes nothing at all:
 * no approval, no mint, no state transition. The inert draft saved before the checkpoint is
 * preparation, not a commitment, so a rejected review is left exactly as approvable as before.
 */
import type { ToolRegistry } from "../tools/ToolRegistry";
import { REVIEW_TOOL } from "../tools/reviewTools";
import type { ReviewReplyApprovalResponse, ReviewReplySubmissionRunResponse } from "../spring/types";
import type { ReviewRunOutcome } from "../state/ReviewAgentState";
import { log } from "../log";

/** Deterministic idempotency key for the review approval, stable across a thread's resumes. */
export function reviewApprovalCommandId(threadId: string, actionRef: string): string {
  return `agent:${threadId}:review-approve:${actionRef}`;
}

export interface ReviewRecordInput {
  readonly threadId: string;
  readonly accountId: string;
  readonly actionRef: string;
  readonly approved: boolean;
  /** The draft version saved before the checkpoint — the version approval binds to. */
  readonly draftVersion: number;
  /** Server-issued fingerprint of that version (one-way hash). */
  readonly draftFingerprint: string;
}

export async function performReviewRecord(
  registry: ToolRegistry,
  input: ReviewRecordInput,
): Promise<ReviewRunOutcome> {
  const { threadId, accountId, actionRef, draftVersion, draftFingerprint } = input;

  if (!input.approved) {
    // Nothing is written on reject: no approval, no guided-session mint, no state
    // transition. The review stays RESPONSE_NEEDED with an inert prepared draft and
    // resurfaces on the next run.
    log("review_record_rejected", { rank: 0, draftVersion });
    return {
      recorded: true,
      decision: "REJECTED",
      actionRef,
      draftVersion,
      approvedFingerprint: null,
      approvalState: null,
      guidedSessionPrepared: false,
      submissionRef: null,
      submissionApprovedVersion: null,
      targetHint: null,
      externalSendAttempted: false,
      note: "operator declined; no approval/guided-session recorded, review left RESPONSE_NEEDED (draft inert)",
    };
  }

  // Record the human approval, binding the exact saved version (idempotent by commandId).
  const commandId = reviewApprovalCommandId(threadId, actionRef);
  const approval = await registry.invoke<ReviewReplyApprovalResponse>(REVIEW_TOOL.APPROVE, {
    accountId,
    actionRef,
    commandId,
    baseVersion: draftVersion,
  });
  log("review_approved", { state: approval.state, replayed: approval.replayed, draftVersion });

  // Prepare the guided reply session: mint a single-use ref bound to the approved head, with
  // the privacy-safe target hint derived + validated server-side. This does NOT send.
  const run = await registry.invoke<ReviewReplySubmissionRunResponse>(
    REVIEW_TOOL.PREPARE_GUIDED_SESSION,
    { accountId, actionRef, requireTargetHint: true },
  );
  log("review_guided_session_prepared", {
    approvedVersion: run.approvedVersion,
    hasTargetHint: run.targetHint != null,
    // submissionRef is opaque (16-hex, not reversible) but still omitted from the log line.
  });

  return {
    recorded: true,
    decision: "APPROVED",
    actionRef,
    draftVersion,
    approvedFingerprint: draftFingerprint,
    approvalState: approval.state,
    guidedSessionPrepared: true,
    submissionRef: run.submissionRef,
    submissionApprovedVersion: run.approvedVersion,
    targetHint: run.targetHint,
    externalSendAttempted: false,
  };
}
