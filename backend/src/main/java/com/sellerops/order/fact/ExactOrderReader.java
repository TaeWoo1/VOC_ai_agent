package com.sellerops.order.fact;

import java.util.UUID;

/**
 * Reads ONE order, named by ONE identifier the channel itself supplied.
 *
 * <p><b>The signature is the fence.</b> There is no date range, no page, no cursor, no name, no
 * phone, no limit, and no way to ask for "the orders around this one". An implementation that wanted
 * to walk history would have to change this interface, which is a review, not an afternoon.
 *
 * <p>An implementation must return an {@link ExactOrderObservation} for every path — a channel that
 * refuses, times out, or does not know the order is a category, not an exception. The one thing it
 * must never do is answer with a DIFFERENT order than the one asked for: if the response does not
 * echo the requested identity, that is {@link ExactOrderReadOutcome#TRANSPORT_ERROR}.
 */
public interface ExactOrderReader {

    /** The channel this reader speaks for — {@code CAFE24}, {@code NAVER}, {@code COUPANG}. */
    String channelCode();

    /**
     * Read the single order this reference names.
     *
     * @param reference the channel's own order identifier, verbatim from
     *                  {@code inquiries.source_order_ref}. Never parsed out of customer text
     */
    ExactOrderObservation read(UUID orgId, UUID sellerAccountId, String reference);
}
