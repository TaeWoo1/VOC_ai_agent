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

    /** The inquiry now reads as answered — someone replied on the channel, or a routine collection saw it. */
    ANSWERED_ELSEWHERE,

    /** The seller dismissed it, or the source's own thread structure excluded it. */
    NOT_OPERATIONAL,

    /** A review that no longer ranks 확인 필요, or whose reply work the seller set aside. */
    NO_LONGER_ACTIONABLE
}
