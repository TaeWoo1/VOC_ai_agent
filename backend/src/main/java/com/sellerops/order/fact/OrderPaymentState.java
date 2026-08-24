package com.sellerops.order.fact;

/**
 * Whether this order has been paid for — one of the three operational states, kept apart from the
 * other two.
 *
 * <p><b>{@link #PARTIALLY_PAID} exists because the platform publishes it.</b> Cafe24's {@code paid}
 * is {@code T}/{@code F}/{@code M} and {@code M} is "Partially paid"; collapsing it to either
 * boundary tells a customer something the mall did not say. A vocabulary that cannot express a
 * platform's own value will express it wrongly.
 *
 * <p><b>{@link #UNPAID} is a claim and {@link #UNKNOWN} is not.</b> Only a source that positively
 * states unpaid may produce {@code UNPAID}; a stored row whose code was never live-confirmed
 * produces {@code UNKNOWN}, and the two render as different sentences.
 */
public enum OrderPaymentState {

    /** The source states payment completed. */
    PAID,

    /** The source states payment NOT completed — awaiting deposit, awaiting card approval. */
    UNPAID,

    /** The source states part of the order is paid. Neither of the above is true of it. */
    PARTIALLY_PAID,

    /** Nothing in what we hold proves any of the above. Never rendered as "미결제". */
    UNKNOWN;

    /** True when a draft may state this payment state as a fact (given freshness). */
    public boolean isProven() {
        return this != UNKNOWN;
    }

    /** The seller-facing label, or null when nothing may be said. */
    public String labelKo() {
        return switch (this) {
            case PAID -> "결제 완료";
            case UNPAID -> "결제 전";
            case PARTIALLY_PAID -> "부분 결제";
            case UNKNOWN -> null;
        };
    }
}
