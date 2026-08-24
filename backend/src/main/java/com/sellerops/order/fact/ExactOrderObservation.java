package com.sellerops.order.fact;

import java.time.Instant;
import java.time.LocalDate;

/**
 * One order, as one channel described it at one instant — the only thing an exact reader may return.
 *
 * <p><b>It is the projection boundary.</b> A channel's order object is large and most of it is a
 * person: name, email, phone, recipient, address, billing name, bank account holder, transaction
 * ids, amounts. This record has no field for any of them, so the connector cannot pass one along
 * even by accident, and a reviewer can see the whole projected surface in one screen.
 *
 * @param outcome    what happened; every field below is meaningful only when {@link
 *                   ExactOrderReadOutcome#OK}
 * @param observedAt when the channel answered. This is the freshness — an exact read is fresh by
 *                   construction, and this is the instant it stops being
 * @param rawStatusCode the channel's own state tokens joined verbatim for later correction. Never
 *                   rendered, never sent to a model
 */
public record ExactOrderObservation(ExactOrderReadOutcome outcome,
                                    OrderPaymentState payment,
                                    OrderCancellationState cancellation,
                                    OrderFulfillmentState fulfillment,
                                    String rawStatusCode,
                                    LocalDate orderedAt,
                                    Instant paidAt,
                                    Instant cancelledAt,
                                    Instant observedAt) {

    /** A failed read: an outcome and nothing else. */
    public static ExactOrderObservation failed(ExactOrderReadOutcome outcome) {
        return new ExactOrderObservation(outcome, null, null, null, null, null, null, null, null);
    }

    public boolean ok() {
        return outcome == ExactOrderReadOutcome.OK;
    }
}
