package com.sellerops.order.fact;

/**
 * Where an {@link OrderFact} came from — and therefore what it is allowed to claim.
 *
 * <p>This is not bookkeeping. {@link OrderCancellationState#NOT_CANCELLED} is reachable from
 * {@link #EXACT_READ} and unreachable from {@link #STORED_CANONICAL}, because the mall answering
 * "canceled: F" one second ago and a stored row being silent about cancellation are not the same
 * evidence. Without provenance on the record, the only place that difference could live is in the
 * head of whoever writes the next caller.
 */
public enum OrderFactProvenance {

    /** A row already in {@code channel_orders}, matched exactly by the reference the channel gave. */
    STORED_CANONICAL,

    /** One bounded READ of one order, by its identifier, under a vendored contract. */
    EXACT_READ;

    /** True when this source may state a NEGATIVE (not cancelled, not paid) rather than silence. */
    public boolean mayStateNegatives() {
        return this == EXACT_READ;
    }
}
