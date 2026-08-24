package com.sellerops.order.fact;

/**
 * Whether this order has been cancelled.
 *
 * <p><b>{@link #NOT_CANCELLED} is the value this repository refused to have until 2026-08-25, and
 * the reason it now exists is worth keeping.</b> The refusal was correct for the STORED path: no
 * order status code in {@code channel_orders} proves a negative, and an order cancelled after our
 * last read looks exactly like one that was never cancelled — so "취소되지 않았습니다" from a stored
 * row is a guess with a citation under it.
 *
 * <p>An exact live READ is a different act. Cafe24 publishes {@code canceled} as {@code F}: "Not
 * Canceled" — a positive statement by the mall, about that order, at the instant we asked. That is
 * exactly the sentence a customer asking "취소됐나요?" needs, and refusing to represent it would
 * make the platform's own answer unusable.
 *
 * <p>The fence therefore moved from the VOCABULARY to the SOURCE: {@code NOT_CANCELLED} is
 * reachable only from {@link OrderFactProvenance#EXACT_READ}, and only a fact whose
 * {@link OrderFactState#mayStateAsCurrent()} is true may be stated without its observation time.
 */
public enum OrderCancellationState {

    /** The source states the order is cancelled. */
    CANCELLED,

    /** The source states, positively, that it is not. Never inferred from an absence. */
    NOT_CANCELLED,

    /** The source states part of the order is cancelled — Cafe24 {@code canceled=M}. */
    PARTIALLY_CANCELLED,

    /** Unproven. NOT "not cancelled". */
    UNKNOWN;

    public boolean isProven() {
        return this != UNKNOWN;
    }

    public String labelKo() {
        return switch (this) {
            case CANCELLED -> "취소됨";
            case NOT_CANCELLED -> "취소되지 않음";
            case PARTIALLY_CANCELLED -> "부분 취소";
            case UNKNOWN -> null;
        };
    }
}
