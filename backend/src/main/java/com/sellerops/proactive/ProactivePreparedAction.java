package com.sellerops.proactive;

/**
 * How far the preparation got — and, read the other way, what the seller still has to do.
 *
 * <p><b>None of these is an approval.</b> A prepared draft is one more append-only version on the
 * existing {@code inquiry_reply_draft}, indistinguishable from one the seller typed except for the
 * provenance stamped on it. The approval boundary, the send, and the verification are all exactly
 * where they were before this package existed.
 */
public enum ProactivePreparedAction {

    /**
     * A reply draft exists and the seller can review, edit, approve and send it through the flow
     * that already ships. Only ever produced for {@link ProactiveSubjectKind#INQUIRY}.
     */
    DRAFT_PREPARED,

    /**
     * The evidence and a recommended next action are prepared; nothing is written for the seller to
     * send. This is the only outcome available for a review, and the reason is a capability fact
     * rather than a scope decision: SellerOps has no proven review-reply WRITE adapter on the visible
     * channels, and inventing a send control for one would put a button in front of a seller that
     * cannot do what it says.
     */
    RECOMMENDATION_ONLY,

    /**
     * The investigation could not complete (the model was unavailable, the org's daily AI budget was
     * spent, the draft path refused). The case still surfaces, because the operational fact behind it
     * is still true and hiding it would be worse than surfacing it thin.
     */
    NONE
}
