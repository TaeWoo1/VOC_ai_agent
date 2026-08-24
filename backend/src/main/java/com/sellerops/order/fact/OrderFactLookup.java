package com.sellerops.order.fact;

/**
 * How hard a caller is allowed to work for an order fact.
 *
 * <p><b>This exists because "we have a reference" is not a reason to call an API.</b> The inquiry
 * coverage audit classifies thousands of rows; the ingestion path stores thousands more. If either
 * were allowed to resolve an order fact the way a screen does, the moment references start arriving
 * the inquiry collector becomes an order collector — one marketplace request per inquiry, for
 * nobody, forever.
 *
 * <p>So the network is not a property of the reader. It is a decision the CALLER states, and only
 * two callers state {@link #EXACT_ALLOWED}: the inquiry detail a person is looking at, and the
 * drafting path that is about to ground a sentence in the answer.
 */
public enum OrderFactLookup {

    /**
     * Read what is already stored. Never touches a channel.
     *
     * <p>The default, and what every batch, audit, ingestion and background path uses.
     */
    STORED_ONLY,

    /**
     * Stored fact first; one bounded exact READ of the one referenced order if the store cannot
     * answer and the channel has a vendored contract for it.
     *
     * <p>Never a list, never a window, never more than the single order this inquiry names.
     */
    EXACT_ALLOWED
}
