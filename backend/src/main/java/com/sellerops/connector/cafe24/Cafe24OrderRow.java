package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Minimal projection of one Cafe24 Admin orders-list row — only the three
 * order-level fields the daily ORDER_SUMMARY needs. Everything else in the
 * (large) order object is ignored.
 *
 * <p>{@code orderDate} is the raw value of the {@code order_date} field (an
 * ISO-8601 string, with or without a zone offset); {@code paymentAmount} is the
 * raw decimal string of {@code payment_amount} (e.g. {@code "10000.00"}). The
 * {@link Cafe24OrderAggregator} owns all interpretation (KST bucketing, decimal
 * → long), so this type carries no parsing logic and makes no zone assumption.
 *
 * <p>Field names are the doc-asserted Cafe24 names; they are a live-verification
 * item (see the connector's {@code NEEDS_VERIFICATION} capability status).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Cafe24OrderRow(
        @JsonProperty("order_id") String orderId,
        @JsonProperty("order_date") String orderDate,
        @JsonProperty("payment_amount") String paymentAmount) {
}
