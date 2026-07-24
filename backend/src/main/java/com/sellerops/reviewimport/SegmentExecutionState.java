package com.sellerops.reviewimport;

/**
 * What happened to a segment's LAST attempt — the execution axis, kept strictly separate from
 * {@link SegmentCoverageState}. These are the only four values (decision, 2026-07-24):
 *
 * <ul>
 *   <li>{@code PENDING} — planned, no attempt in flight (initial, and where a FAILED segment returns on retry).</li>
 *   <li>{@code ACTIVE} — an attempt is in progress (scope confirmed / exporting / ingesting).</li>
 *   <li>{@code COMPLETED} — the last attempt exported and ingested successfully (a valid EMPTY export included).</li>
 *   <li>{@code FAILED} — the last attempt failed; it is retryable.</li>
 * </ul>
 *
 * <p><b>{@code FAILED} is an attempt outcome, never a coverage conclusion.</b> A range that cannot be
 * covered is expressed on the coverage axis as {@link SegmentCoverageState#MISSING}, not here.
 */
public enum SegmentExecutionState {
    PENDING,
    ACTIVE,
    COMPLETED,
    FAILED;

    /** A segment still needing an export attempt (planned or previously failed). */
    public boolean isRemaining() {
        return this == PENDING || this == FAILED;
    }
}
