package com.sellerops.reviewimport;

/**
 * The outcome of one {@link ReviewImportSegmentAttempt}. Distinct from the segment's derived
 * {@link SegmentExecutionState}: a segment may hold several attempts (retry history), and its execution
 * state reflects the latest one.
 *
 * <ul>
 *   <li>{@code ACTIVE} — the attempt is in flight (scope confirmed / awaiting the export + ingest).</li>
 *   <li>{@code SUCCEEDED} — the export was ingested (a valid empty counts as success).</li>
 *   <li>{@code FAILED} — the attempt failed (no confirmed scope, export/validate/ingest error, or abort).</li>
 * </ul>
 */
public enum SegmentAttemptResult {
    ACTIVE,
    SUCCEEDED,
    FAILED
}
