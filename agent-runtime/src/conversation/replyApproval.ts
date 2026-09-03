/**
 * **Does an approval stand for the draft the seller would send RIGHT NOW?** (Guided Reply UX Smoothing v1 §1)
 *
 * One question, one answer, in one place — because it is asked from two sides that must not drift: the
 * runtime asks it to decide which card the conversation draws, and the backend asks it again when the
 * guided run is minted (`POST …/reply/submission-run` refuses with 409 when nothing is approved). If this
 * file said yes where the backend says no, the seller would press a primary that fails.
 *
 * <b>An approval is not a flag on a review — it is a binding to one exact version.</b> Three ways it can
 * be absent, and they are all the same answer here:
 * <ul>
 *   <li>never approved — the approval object does not exist yet,</li>
 *   <li>withdrawn — the seller took it back so they could edit,</li>
 *   <li><b>stale</b> — approved, but the draft moved on. A standing approval freezes the text, so this
 *       shape appears when the seller withdrew, edited and did not re-approve; version AND fingerprint
 *       are both checked, because a version number equal by coincidence is not the same sentence.</li>
 * </ul>
 * Only the third is subtle, and it is exactly the one this package must never get wrong: reusing a stale
 * approval would fill a marketplace composer with a sentence nobody currently approved.
 *
 * Pure: no I/O, no time, no seller-facing words.
 */
import type { ReviewReplyPrepView } from "../spring/types";

/** The stored draft version an approval would bind to. */
export interface ReviewDraftHead {
  readonly version: number;
  readonly contentFingerprint: string;
}

export type ReplyApprovalState =
  /** Nothing to approve — the review has no saved draft version at all. */
  | { readonly kind: "NO_DRAFT" }
  /** There is a head, and no approval stands for it. The seller's press is what changes that. */
  | { readonly kind: "NEEDS_APPROVAL"; readonly head: ReviewDraftHead }
  /** An approval stands for exactly this head. The guided run may be minted against it. */
  | { readonly kind: "APPROVED"; readonly head: ReviewDraftHead };

export function replyApprovalStateOf(prep: ReviewReplyPrepView): ReplyApprovalState {
  const draft = prep.draft;
  if (!draft) return { kind: "NO_DRAFT" };
  const head: ReviewDraftHead = { version: draft.version, contentFingerprint: draft.contentFingerprint };
  const approval = prep.approval;
  if (!approval || approval.state !== "APPROVED") return { kind: "NEEDS_APPROVAL", head };
  const bound =
    approval.approvedVersion === head.version && approval.approvedFingerprint === head.contentFingerprint;
  return bound ? { kind: "APPROVED", head } : { kind: "NEEDS_APPROVAL", head };
}
