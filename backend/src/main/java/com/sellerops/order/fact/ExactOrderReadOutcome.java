package com.sellerops.order.fact;

/**
 * What happened when one order was read by its identifier — the audit vocabulary.
 *
 * <p><b>Categories, not messages.</b> These are what {@link ExactOrderReadAudit} records and what a
 * later reader counts. A category never carries the order id, the mall id, the token, or any part of
 * the response; the whole point of having a closed vocabulary is that the observable surface cannot
 * grow a free-text field that someone fills with a payload.
 *
 * <p><b>{@link #NOT_FOUND} is the narrow one.</b> It means the channel answered and said there is no
 * such order. Every other failure — a 500, a timeout, a shape we could not parse — is
 * {@link #TRANSPORT_ERROR}, because "we could not reach it" and "it does not exist" lead a customer
 * to opposite conclusions and only one of them is ever proven.
 */
public enum ExactOrderReadOutcome {

    /** The channel returned the order. */
    OK,

    /** The channel answered and there is no such order for this connection. */
    NOT_FOUND,

    /** This channel has no vendored exact-lookup contract; nothing was called. */
    NOT_CAPABLE,

    /** Authorization failed or the grant does not cover this read. Nothing about the order is known. */
    UNAUTHORIZED,

    /** The channel refused for rate reasons. Retryable; proves nothing about the order. */
    RATE_LIMITED,

    /** Reached and did not get a usable answer. Proves nothing about the order. */
    TRANSPORT_ERROR;

    /** Which no-fact state this outcome means, when it is not {@link #OK}. */
    public OrderFactState asFactState() {
        return switch (this) {
            case NOT_FOUND -> OrderFactState.ORDER_NOT_FOUND;
            case OK -> throw new IllegalStateException("OK is not a no-fact state");
            default -> OrderFactState.SOURCE_UNAVAILABLE;
        };
    }
}
