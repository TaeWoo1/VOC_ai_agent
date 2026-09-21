package com.sellerops.proactive;

/**
 * Why a prepared case stopped being the seller's business, when the seller never acted on it.
 *
 * <p>Recorded rather than deleted. "The card vanished" and "the card vanished because the customer's
 * question was answered on the channel" are different things to a seller who is looking for it, and
 * only one of them can be explained afterwards.
 */
public enum ProactiveCloseReason {

    /** The source state changed, so a fresh investigation replaced this one. */
    SUPERSEDED,

    /**
     * This organisation's customer-operations responsibility took the subject over, and its case is canonical now.
     *
     * <p>Distinct from {@link #SUPERSEDED} because <b>nothing about the customer changed</b> — what changed is who
     * answers for them. Collapsing the two would erase the only record of the handover, and a card closed while the
     * work behind it was still open is exactly the kind that has to be able to say why.
     *
     * <p>It is also the close that keeps the responsibility alive. One open card per subject is a database
     * constraint spanning BOTH producers, so a legacy card left standing holds that slot against the operations
     * case — and holds it forever, because the proactive loop does not run for a delegated organisation and could
     * never have closed it itself.
     */
    DELEGATED_TO_RESPONSIBILITY,

    /** The inquiry now reads as answered — someone replied on the channel, or a routine collection saw it. */
    ANSWERED_ELSEWHERE,

    /** The seller dismissed it, or the source's own thread structure excluded it. */
    NOT_OPERATIONAL,

    /** A review that no longer ranks 확인 필요, or whose reply work the seller set aside. */
    NO_LONGER_ACTIONABLE
}
