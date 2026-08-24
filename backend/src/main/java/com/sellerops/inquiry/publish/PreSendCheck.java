package com.sellerops.inquiry.publish;

/**
 * The answer to "may this exact approval be spent, right now, on this exact target?" — evaluated
 * immediately before the only marketplace WRITE in the product.
 *
 * <p><b>Why a re-check exists at all.</b> An approval is a statement about a moment: the seller read
 * this draft, for this inquiry, on this account. Time passes between that moment and the dispatch —
 * a resume after a restart can put hours in between — and everything the statement referred to can
 * move. The confirm already proved the TEXT is the one that was read; this proves the TARGET is the
 * one that was agreed to, and that it is still answerable.
 *
 * <p><b>Two different negatives, kept apart.</b> {@link #refused} means a fact contradicts the
 * approval — a different account, a different inquiry handle, a different source resource, or an
 * inquiry that already carries an answer. Nothing is sent. {@link #stateProven} being false means
 * something could not be checked: the channel's own collection is not currently fresh, so "still
 * unanswered" is the last thing SellerOps saw rather than the thing that is true now. That is not a
 * refusal — a quiet channel would otherwise make the feature unusable — but it is never silence
 * either: it is recorded on the execution row and shown on the confirm screen before the press, so
 * the human who accepts the risk is the human who was told about it.
 *
 * @param refused     true when a fact contradicts the approval — do not dispatch
 * @param reason      closed-vocabulary reason; null when nothing is wrong
 * @param stateProven whether the target's answerability was proven by a currently-fresh collection
 * @param note        closed-vocabulary reason the state could not be proven; null when it was
 */
public record PreSendCheck(boolean refused, String reason, boolean stateProven, String note) {

    /** Nothing contradicts the approval and the target's state was proven current. */
    public static PreSendCheck proven() {
        return new PreSendCheck(false, null, true, null);
    }

    /** Nothing contradicts the approval, but the target's current state could not be proven. */
    public static PreSendCheck unproven(String note) {
        return new PreSendCheck(false, null, false, note);
    }

    /** A fact contradicts the approval. Never dispatch. */
    public static PreSendCheck refuse(String reason) {
        return new PreSendCheck(true, reason, false, null);
    }

    // --- Closed vocabulary. Each value names ONE thing that moved, so an audit row says which. ---

    /** The approval carries no target snapshot (written before V66) — unprovable, so closed. */
    public static final String NO_TARGET_SNAPSHOT = "NO_TARGET_SNAPSHOT";
    /** The work item's seller account is not the one the approval was granted for. */
    public static final String ACCOUNT_CHANGED = "ACCOUNT_CHANGED";
    /** The work item's channel is not the one the approval was granted for. */
    public static final String CHANNEL_CHANGED = "CHANNEL_CHANGED";
    /** The inquiry's marketplace handle is not the one the approval was granted for. */
    public static final String TARGET_CHANGED = "TARGET_CHANGED";
    /** The inquiry came from a different source resource than the approval named. */
    public static final String SUBTYPE_CHANGED = "SUBTYPE_CHANGED";
    /** The inquiry already carries an answer — a second answer is not a retry. */
    public static final String ALREADY_ANSWERED = "ALREADY_ANSWERED";
    /** The inquiry is no longer active for this org (dismissed, or gone from the source). */
    public static final String NOT_ANSWERABLE = "NOT_ANSWERABLE";
    /**
     * The target is not the seller's own data — a DEMO_SEED or VERIFY_FIXTURE row.
     *
     * <p>Such a row has an {@code external_id} shaped exactly like a real one, and the marketplace
     * would be asked to answer whatever that string happens to name over there. The queue already
     * refuses to carry synthetic work, so reaching this line means a row was manufactured after its
     * approval was granted, or an approval predates the queue fence. Either way it is a refusal, not
     * a warning: the send is the irreversible step and this is the last place before it.
     */
    public static final String SYNTHETIC_TARGET = "SYNTHETIC_TARGET";
    /**
     * SellerOps has no audited, implemented way to post a reply to this channel + source subtype.
     *
     * <p>Distinct from "no adapter registered", which is a deployment fact (execution disabled). This
     * one is the capability answer: NAVER publishes answer endpoints SellerOps has not connected, and
     * Cafe24's write contract has never been audited. Both must stop a dispatch, and a seller reading
     * the outcome should see which of the two it was.
     */
    public static final String WRITE_NOT_SUPPORTED = "WRITE_NOT_SUPPORTED";

    /** The channel's INQUIRY collection is not currently fresh — the answer state may have moved. */
    public static final String STATE_NOT_FRESH = "STATE_NOT_FRESH";
    /** No coverage row for this channel's INQUIRY at all — nothing to read the freshness off. */
    public static final String STATE_UNKNOWN = "STATE_UNKNOWN";
}
