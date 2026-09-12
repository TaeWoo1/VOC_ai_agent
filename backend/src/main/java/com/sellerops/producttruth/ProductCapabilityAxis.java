package com.sellerops.producttruth;

/**
 * The four questions a seller-facing capability claim can answer about one channel × object.
 *
 * <p>Separate axes rather than one row per pair because they are proven separately and drift apart:
 * Cafe24 리뷰 acquisition has been live-proven since 2026-07-30 while its execution path has never
 * posted a comment to a mall. A single row would have to pick one evidence strength for both, and
 * whichever it picked would be a lie about the other half.
 */
public enum ProductCapabilityAxis {
    /** How the data reaches reviewnary at all. */
    ACQUISITION,
    /** What reviewnary can read and reason about once it is here. */
    READ,
    /** Whether an answer/reply draft is prepared for this object. */
    DRAFT,
    /** How an approved answer reaches the channel — and whose hands complete it. */
    EXECUTION,
}
