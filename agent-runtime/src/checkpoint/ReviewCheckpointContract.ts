/**
 * Human-checkpoint contract for the review-reply subgraph.
 *
 * <b>The defining difference from the inquiry checkpoint: this request carries NO review
 * body and NO reply text.</b> The draft is already persisted in the backend (the system of
 * record) by the time the graph pauses, so the checkpoint identifies WHICH version to
 * approve — by `draftVersion` + `draftFingerprint` — rather than shipping the text. The
 * operator/UI reads the actual draft and review body out-of-band via GET …/reply. This is
 * exactly the boundary the task fixes: "checkpoint에는 review ID, draft version ID,
 * fingerprint, phase만 저장". The extra fields below (rating/date/productName/
 * priorityBucket/category/idFingerprint) are coarse, non-content LOCATING aids — the same
 * values the backend prep view already surfaces so a human can find the row; none is the
 * review body or the reply text.
 *
 * The decision carries no inline edit: at the checkpoint an operator approves or rejects the
 * saved version. Editing happens on the prep surface (PUT …/draft) out-of-band, which keeps
 * "resume with the SAME draft version" exact.
 */
import { z } from "zod";

export const REVIEW_CHECKPOINT_KIND = "REVIEW_REPLY_APPROVAL" as const;

/**
 * Orchestration phase — NOT a backend state. Reviews have no work-item phase machine
 * (triage is a decision, approval is APPROVED/WITHDRAWN); this names where the RUN is.
 */
export type ReviewReplyPhase =
  | "DRAFT_SAVED"
  | "APPROVED"
  | "REJECTED"
  | "GUIDED_SESSION_READY"
  | "NONE";

/** What the human sees when the review graph pauses for approval. NO body, NO reply text. */
export interface ReviewCheckpointRequest {
  readonly kind: typeof REVIEW_CHECKPOINT_KIND;
  /** The review's client-opaque address (`review:<uuid>`) — the review ID. */
  readonly actionRef: string;
  /** The saved draft version to be approved. */
  readonly draftVersion: number;
  /** The server-issued content fingerprint of that version (a one-way hash, not content). */
  readonly draftFingerprint: string;
  /** Orchestration phase at the pause (DRAFT_SAVED). */
  readonly phase: ReviewReplyPhase;
  // ---- coarse, non-content locating aids (all already on the backend prep view) ----
  readonly priorityBucket: string;
  readonly category: string;
  readonly rating: number | null;
  readonly reviewDate: string | null;
  readonly productName: string | null;
  /** One-way review-id fingerprint (digest of the channel-side id), or null. Not the raw id. */
  readonly channelReviewIdFingerprint: string | null;
}

/** What the human returns to resume the review graph. Approve/reject only — no inline edit. */
export interface ReviewCheckpointDecision {
  readonly approved: boolean;
  /** Operator identity recorded on the approval (SELLER:<userId> on the backend). */
  readonly approvedBy: string;
}

/**
 * The resume value crosses the interrupt boundary from outside the graph, so it is validated
 * (not trusted). A malformed decision fails closed to a rejection — never an approval.
 */
export const ReviewCheckpointDecisionSchema = z.object({
  approved: z.boolean(),
  approvedBy: z.string().min(1),
});

/** Validate a resumed review decision; on any parse failure, fail closed to a rejection. */
export function parseReviewDecision(value: unknown): ReviewCheckpointDecision {
  const parsed = ReviewCheckpointDecisionSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { approved: false, approvedBy: "unknown" };
}
