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

    /** The channel's INQUIRY collection is not currently fresh — the answer state may have moved. */
    public static final String STATE_NOT_FRESH = "STATE_NOT_FRESH";
    /** No coverage row for this channel's INQUIRY at all — nothing to read the freshness off. */
    public static final String STATE_UNKNOWN = "STATE_UNKNOWN";
}
