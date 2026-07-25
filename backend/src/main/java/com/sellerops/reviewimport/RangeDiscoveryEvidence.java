package com.sellerops.reviewimport;

/**
 * How a plan's historical range was established.
 *
 * <p>Stored rather than inferred because the values are not equally strong and flattening them would let a
 * human's choice be presented as something SellerOps verified. Nothing that surfaces this value may describe
 * {@link #OPERATOR_CONFIRMED} or {@link #OPERATOR_SELECTED} as machine-verified.
 *
 * <p><b>{@link #OPERATOR_SELECTED} is the only value new plans get</b> as of 2026-07-26. The first two describe
 * a mechanism that no longer runs: a guided run used to drive the seller through NAVER's own date pickers to
 * find how far back the marketplace would let them reach. The 2026-07-25 live run established that NAVER's
 * review calendar restricts nothing, so there was no limit to discover — and the product owner reframed the
 * question as the seller's own decision about how much history to import. The old values remain because rows
 * carrying them exist and must stay readable for what they actually meant.
 *
 * <p>Persisted as a string in a {@code varchar(24)} column with no check constraint (V28), so adding a value
 * needs no migration.
 */
public enum RangeDiscoveryEvidence {

    /**
     * SellerOps read the available range off the live seller-center controls itself (date input bounds,
     * disabled calendar dates, or a range-limit notice).
     */
    MACHINE_DISCOVERED,

    /**
     * SellerOps could not read the range, so the guided tutorial asked the seller to select the earliest
     * and latest dates the marketplace allowed and confirm them. A human assertion, not a measurement.
     *
     * <p>Historical: no run produces this any more.
     */
    OPERATOR_CONFIRMED,

    /**
     * The seller chose how far back to import, in SellerOps, before any marketplace window was opened: they
     * picked a start month, the end is today, and they confirmed the period and the number of monthly segments
     * it becomes.
     *
     * <p>This asserts nothing at all about what the marketplace allows. A month inside the chosen period that
     * turns out to be unreachable surfaces later as {@link SegmentCoverageState#MISSING} — per segment, from a
     * real attempt — which is the only honest place that can be discovered.
     */
    OPERATOR_SELECTED
}
