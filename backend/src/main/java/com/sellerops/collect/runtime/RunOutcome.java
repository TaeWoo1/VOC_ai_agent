package com.sellerops.collect.runtime;

/**
 * In-code classification of a finished collection run. Deliberately distinct from the
 * persisted {@code sync_jobs.status} value: {@link #RATE_LIMITED} in particular is never
 * stored as a status — it maps to PARTIAL/FAILED while the rate-limit fact is carried by
 * {@code rate_limited=true} plus a failure code (see {@link ConnectorResult#jobStatus()}).
 */
public enum RunOutcome {
    SUCCESS,
    PARTIAL,
    FAILED,
    RATE_LIMITED,
    NOT_ATTEMPTED;

    /**
     * Classify a finished run from its row tallies and abnormality flags. Mirrors the
     * incremental-collection rule already used by {@code SyncRunExecutor.resolveStatus}:
     * any abnormality is PARTIAL when some data landed, otherwise FAILED; a clean run
     * (including an empty incremental pull) is SUCCESS. Rate limiting is its own
     * classification and is checked first.
     */
    public static RunOutcome classify(int successRows, int skippedRows, int failedRows,
                                      boolean rateLimited, boolean errored) {
        if (rateLimited) {
            return RATE_LIMITED;
        }
        if (errored || failedRows > 0) {
            return (successRows + skippedRows > 0) ? PARTIAL : FAILED;
        }
        return SUCCESS;
    }
}
