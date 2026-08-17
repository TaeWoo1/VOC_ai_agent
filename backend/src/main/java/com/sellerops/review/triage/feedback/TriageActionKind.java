package com.sellerops.review.triage.feedback;

/**
 * What the seller did about a review. Explicit — each one is a control the operator pressed
 * ({@code contracts/review-triage-events/v1/CONTRACT.md} §2.1–§2.2).
 *
 * <p>{@code ACTION_COMPLETED} is the strongest evidence this spine has that a review was actionable:
 * someone decided something had to be done and did it (feedback draft §7.2). {@code ACTION_NOT_NEEDED}
 * is the explicit form of "nothing to do here" — the ONLY form. Being passed over is not recorded as
 * an action, because being passed over is what happens to everything in a queue nobody worked that day.
 *
 * <p>{@code REPLY_*} are channel-gated: written only where {@code ReviewTriageChannelCapability}
 * says the product has a reply flow (NAVER's guided one). Coupang has no reply feature and a
 * {@code REPLY_*} on a Coupang review is refused, not stored with a flag. Neither is ever a verified
 * post — SellerOps has no review API to verify one — they are the seller's own statement, stored as one.
 */
public enum TriageActionKind {
    ACTION_STARTED,
    ACTION_COMPLETED,
    ACTION_NOT_NEEDED,
    REPLY_DRAFTED,
    REPLY_SUBMITTED
}
