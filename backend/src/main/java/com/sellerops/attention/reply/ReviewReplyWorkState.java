package com.sellerops.attention.reply;

/**
 * Where one review's reply work stands, for a surface that has to tell a seller WHICH of their
 * committed reviews is waiting on them.
 *
 * <p><b>Why this exists at all.</b> The drill-down already carried
 * {@code OperatorVocItem.hasReplyPreparation} — one boolean meaning "a draft or an approval exists" —
 * and that boolean is exactly right for what it was built for: deciding whether to MOUNT the reply
 * panel, where a withdrawn approval and a standing one are equally reasons to keep the operator's work
 * on screen. It cannot answer the seller's question. 「승인을 기다리는 리뷰」 and 「이미 승인해 둔 리뷰」
 * are both {@code true} under it, and they are opposite instructions: one asks the seller to read a
 * draft, the other asks them to go and post it. A screen that merges them sends the seller to a review
 * that needs nothing from them, which is how a work queue stops being read.
 *
 * <p><b>Three states, each a fact the database answers</b> — no inference, no ranking, no schedule:
 * the operator committed and there is nothing written yet; something is written and no approval stands;
 * an approval stands. Nothing here says a reply was posted: that is
 * {@code reportedOutcome}/{@code verification}, permanently UNVERIFIED, and it is a different column
 * for the same reason this is a different question.
 *
 * <p>Null — not a fourth member — is what a row gets when it cannot carry reply work at all (no
 * {@code actionRef}: every Cafe24 community article). An absence of capability is rendered as the
 * absence of a statement, never as a state.
 */
public enum ReviewReplyWorkState {

    /** Committed to (or otherwise on the worklist) with no draft and no approval written yet. */
    DRAFT_NEEDED,

    /**
     * A draft exists and no approval stands. This is the state the seller is asked to act on, and the
     * one a withdrawn approval returns to — a withdrawal puts the review back in front of the seller
     * rather than leaving it looking finished.
     */
    AWAITING_APPROVAL,

    /**
     * An approval stands on the current head. The seller's next step is outside this product (the
     * seller center), so this state must never be read as 「완료」.
     */
    APPROVED;

    /**
     * The state implied by the two facts a batch read can establish for one review.
     *
     * <p>A standing approval wins over the draft flag because it is the more specific fact: an approval
     * can only stand on a draft, so 「초안이 있다」 is true of both and says less.
     */
    public static ReviewReplyWorkState of(boolean hasDraft, boolean hasStandingApproval) {
        if (hasStandingApproval) {
            return APPROVED;
        }
        return hasDraft ? AWAITING_APPROVAL : DRAFT_NEEDED;
    }
}
