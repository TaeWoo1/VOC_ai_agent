package com.sellerops.collect.runtime;

import com.sellerops.connector.DataType;

/**
 * Method-agnostic result of one collection run. The three collection paths — API pull,
 * supervised seller-center export, manual upload — fold into this single contract so one
 * runtime can persist them uniformly.
 *
 * <p>Two layers, deliberately separated:
 * <ul>
 *   <li><b>internal / DB</b> — the raw row tallies ({@code totalRows/successRows/
 *       skippedRows/failedRows}) are stored on {@code sync_jobs} exactly as today.</li>
 *   <li><b>sanitized</b> — anything logged or exposed must go through
 *       {@link SanitizedRunView}, which emits only buckets / enum names / booleans /
 *       a 16-hex hash. This record is never serialized to a log or an external API.</li>
 * </ul>
 *
 * <p>{@code failureCode} is a bounded classification code (e.g. {@code "RATE_LIMITED"},
 * {@code "PROVIDER_UNAVAILABLE"}), never a raw provider error message.
 */
public record ConnectorResult(
        String channelCode,
        DataType dataType,
        CollectionMethod method,
        RunOutcome outcome,
        int totalRows,
        int successRows,
        int skippedRows,
        int failedRows,
        boolean rateLimited,
        String failureCode) {

    /**
     * Build from row tallies + abnormality flags, deriving the outcome via
     * {@link RunOutcome#classify}. When rate limited and no explicit code is given, the
     * failure code defaults to {@code "RATE_LIMITED"} so the reason is always carried.
     */
    public static ConnectorResult of(String channelCode, DataType dataType, CollectionMethod method,
                                     int successRows, int skippedRows, int failedRows,
                                     boolean rateLimited, boolean errored, String failureCode) {
        RunOutcome outcome = RunOutcome.classify(successRows, skippedRows, failedRows, rateLimited, errored);
        int total = successRows + skippedRows + failedRows;
        String code = (rateLimited && failureCode == null) ? "RATE_LIMITED" : failureCode;
        return new ConnectorResult(channelCode, dataType, method, outcome,
                total, successRows, skippedRows, failedRows, rateLimited, code);
    }

    /**
     * Map this run to the persisted {@code sync_jobs.status} value. Critically,
     * {@link RunOutcome#RATE_LIMITED} is NOT a status: it maps to PARTIAL when some data
     * landed, otherwise FAILED — and the rate-limit fact lives in {@code rate_limited=true}
     * plus {@code failureCode}. The persisted status set therefore stays the existing four
     * values (SUCCESS / PARTIAL / FAILED; RUNNING is set at open time).
     */
    public String jobStatus() {
        return switch (outcome) {
            case SUCCESS -> "SUCCESS";
            case PARTIAL -> "PARTIAL";
            case FAILED -> "FAILED";
            case RATE_LIMITED -> (successRows + skippedRows > 0) ? "PARTIAL" : "FAILED";
            case NOT_ATTEMPTED -> throw new IllegalStateException(
                    "NOT_ATTEMPTED has no persisted run status");
        };
    }
}
