package com.sellerops.order.fact;

/**
 * Where this order is on its way to the customer.
 *
 * <p><b>None of these values is a date.</b> {@link #AWAITING_SHIPMENT} says the mall has not shipped
 * it; it does not say when the mall will. "언제 도착하나요?" is not answered by any value here, and
 * the drafting prompt forbids continuing one of these into a promise — see {@code AgentDraftPrompt}.
 *
 * <p>The vocabulary is Cafe24's own {@code shipping_status} ({@code F}/{@code M}/{@code T}/{@code
 * W}/{@code X}), because that is the only fulfillment vocabulary this repository holds a contract
 * for. A channel whose codes have not been live-confirmed maps to {@link #UNKNOWN}.
 */
public enum OrderFulfillmentState {

    /** Cafe24 {@code F} — Awaiting shipment. Not yet dispatched; no dispatch date is implied. */
    AWAITING_SHIPMENT,

    /** Cafe24 {@code M} — In transit. */
    IN_TRANSIT,

    /** Cafe24 {@code T} — Delivered. */
    DELIVERED,

    /** Cafe24 {@code W} — Shipment on hold. */
    ON_HOLD,

    /** Cafe24 {@code X} — Awaiting confirmation. */
    AWAITING_CONFIRMATION,

    /** Unproven — including every stored code this repository has never live-confirmed. */
    UNKNOWN;

    public boolean isProven() {
        return this != UNKNOWN;
    }

    public String labelKo() {
        return switch (this) {
            case AWAITING_SHIPMENT -> "발송 준비 중";
            case IN_TRANSIT -> "배송 중";
            case DELIVERED -> "배송 완료";
            case ON_HOLD -> "발송 보류";
            case AWAITING_CONFIRMATION -> "확인 대기";
            case UNKNOWN -> null;
        };
    }
}
