package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * The seven fields SellerOps reads from a Cafe24 single-order response, and the ~60 it does not.
 *
 * <p><b>{@code ignoreUnknown} is the privacy fence, not a convenience.</b> The vendored contract
 * ({@code docs/vendor/cafe24-admin-api/get-orders-order-id.md}) lists {@code member_id},
 * {@code member_email}, {@code billing_name}, {@code bank_account_owner_name},
 * {@code transaction_ids}, {@code payment_amount} and more in the BASE response — they arrive
 * whether we want them or not. Declaring no field for them means they are never materialized into a
 * Java object at all: there is nothing to log by accident, nothing to pass into a prompt, nothing
 * for a future {@code toString()} to find. Discarding at the parse boundary is the only discard that
 * cannot be undone by a later edit somewhere else.
 *
 * <p>The two sub-resources that exist purely to carry a person — {@code buyer} (orderer) and
 * {@code receivers} (recipient) — are <em>opt-in embeds</em> on this endpoint, and
 * {@link Cafe24OrdersClient#orderDetailUri} requests neither. So they are absent from the wire, not
 * merely absent from this record.
 *
 * @param orderId  echoed back so the caller can verify the mall answered about the order we asked
 *                 about. Never leaves the connector layer
 * @param paid     {@code T} Paid / {@code F} Unpaid / {@code M} Partially paid
 * @param canceled {@code T} Canceled / {@code F} Not Canceled / {@code M} Partially canceled
 * @param shippingStatus {@code F} Awaiting shipment / {@code M} In transit / {@code T} Delivered /
 *                 {@code W} Shipment on hold / {@code X} Awaiting confirmation
 * @param orderDate   ordered date, as the mall formats it
 * @param paymentDate payment date, as the mall formats it
 * @param cancelDate  order cancellation date, as the mall formats it
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Cafe24OrderDetailRow(
        @JsonProperty("order_id") String orderId,
        @JsonProperty("paid") String paid,
        @JsonProperty("canceled") String canceled,
        @JsonProperty("shipping_status") String shippingStatus,
        @JsonProperty("order_date") String orderDate,
        @JsonProperty("payment_date") String paymentDate,
        @JsonProperty("cancel_date") String cancelDate) {

    /**
     * The three state tokens, joined, for verbatim storage on the fact.
     *
     * <p>Kept because a correction later — "we mapped {@code X} wrongly" — must be possible without
     * calling the mall again, and because the joined form is what a reviewer compares to the vendored
     * table. Never rendered and never sent to a model.
     */
    public String rawStatusCode() {
        return "paid=" + nz(paid) + ";canceled=" + nz(canceled) + ";shipping=" + nz(shippingStatus);
    }

    private static String nz(String value) {
        return value == null || value.isBlank() ? "?" : value;
    }
}
