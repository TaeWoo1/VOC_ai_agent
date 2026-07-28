package com.sellerops.order;

/**
 * The deliberately minimal normalization of a channel's raw order status. Under the current NAVER
 * request scope ({@code lastChangedType=PAYED}) the only status actually observed is payment-completed,
 * so this normalization is honest about what it can and cannot claim:
 *
 * <ul>
 *   <li>{@link #PAID} — raw {@code "PAYED"}, the payment-completed status.</li>
 *   <li>{@link #UNKNOWN} — any other or unrecognized raw code. <b>Fail closed:</b> we never guess a
 *       shipping / cancel / return / claim meaning from a code we have not observed live.</li>
 * </ul>
 *
 * <p>The raw code is always stored verbatim beside this. Extending normalization (and observing real
 * status transitions) requires widening the request's {@code lastChangedType} and confirming the value
 * set against a real seller — {@code correct-IP live proof pending}.
 */
public enum NormalizedOrderStatus {
    PAID,
    UNKNOWN;

    /** Map a raw channel status code to a canonical status, failing closed on anything unobserved. */
    public static NormalizedOrderStatus fromRaw(String rawStatusCode) {
        return "PAYED".equals(rawStatusCode) ? PAID : UNKNOWN;
    }
}
