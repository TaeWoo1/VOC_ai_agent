/**
 * Human-checkpoint contract.
 *
 * The vertical slice stops the graph at a human checkpoint (LangGraph `interrupt`) and
 * can only proceed when a human resumes it with an explicit decision. This module fixes
 * the two shapes that cross that boundary — the request surfaced to the human and the
 * decision they return — plus the checkpointer used to persist a paused run.
 *
 * The request DOES carry the draft candidate content, because a human must read it to
 * approve or edit it. That content therefore lives only in the interrupt payload and in
 * memory — never in a log line (see {@link ../log}).
 */
import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { z } from "zod";
import type { DraftCandidate } from "../provider/DraftModelSeam";

export const CHECKPOINT_KIND = "INQUIRY_REPLY_APPROVAL" as const;

/** What the human sees when the graph pauses for approval. */
export interface CheckpointRequest {
  readonly kind: typeof CHECKPOINT_KIND;
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly priorityBucket: string;
  /** Coarse reply category of the starter draft (rule-based). */
  readonly category: string;
  /** The starter draft the human reviews/edits. Content — keep out of logs. */
  readonly candidate: DraftCandidate;
}

/** What the human returns to resume the graph. */
export interface CheckpointDecision {
  readonly approved: boolean;
  /** Operator identity recorded on the approval (SELLER:<userId> on the backend). */
  readonly approvedBy: string;
  /** Optional human edits to the starter draft; used only when approved. */
  readonly editedTitle?: string;
  readonly editedComments?: string;
}

/**
 * The resume value crosses the interrupt boundary from outside the graph, so it is
 * validated (not trusted) exactly like a tool input. A malformed decision fails closed
 * to a rejection — never an approval — via {@link parseDecision}.
 */
export const CheckpointDecisionSchema = z.object({
  approved: z.boolean(),
  approvedBy: z.string().min(1),
  editedTitle: z.string().optional(),
  editedComments: z.string().optional(),
});

/** Validate a resumed decision; on any parse failure, fail closed to a rejection. */
export function parseDecision(value: unknown): CheckpointDecision {
  const parsed = CheckpointDecisionSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { approved: false, approvedBy: "unknown" };
}

/**
 * Checkpointer for paused runs. In-memory for this slice (matches the collector's
 * journey-shadow), deliberately non-durable: a process restart loses in-flight paused
 * runs, and the backend — not this saver — remains the durable record of every approval
 * and audit event. A durable saver (e.g. Postgres-backed) drops in behind this factory
 * when cross-process resume is needed.
 */
export function createCheckpointer(): BaseCheckpointSaver {
  return new MemorySaver();
}

/** Build the LangGraph run config for a thread. `thread_id` is a synthetic run id. */
export function threadConfig(threadId: string) {
  // `callbacks: []` is defence-in-depth against inherited tracing handlers, mirroring
  // the collector's journey-shadow. This runtime never enables external tracing.
  return { configurable: { thread_id: threadId }, callbacks: [] };
}
