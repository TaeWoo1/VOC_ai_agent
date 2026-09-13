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
 *
 * <p><b>The three {@code ACTION_*} are not channel-gated, and {@link #isSellerAct()} is where that is
 * said once</b> (Core Channel Boundary v1). They record something the seller did on their own side of
 * the counter — started, finished, decided it was unnecessary — and none of them is a claim about a
 * marketplace. A channel outside the triage contract's three cannot produce an AI mark or a behaviour
 * event, which is why those stay gated; it has no bearing on whether a person may write down what
 * they did about their own review. Before this, a GMARKET review the seller had uploaded themselves
 * refused all five kinds with the same 404.
 */
public enum TriageActionKind {
    ACTION_STARTED,
    ACTION_COMPLETED,
    ACTION_NOT_NEEDED,
    REPLY_DRAFTED,
    REPLY_SUBMITTED;

    /**
     * Whether this is a statement about what the SELLER did, rather than a claim that a reply exists
     * on a channel. The first kind is Core and travels with the review; the second needs the channel
     * to have a reply flow at all, and {@code ReviewTriageChannelCapability.permits} still answers that.
     */
    public boolean isSellerAct() {
        return this == ACTION_STARTED || this == ACTION_COMPLETED || this == ACTION_NOT_NEEDED;
    }
}
