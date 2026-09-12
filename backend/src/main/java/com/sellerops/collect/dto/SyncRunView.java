package com.sellerops.collect.dto;

import com.sellerops.collect.ReviewCoverageSignal;
import com.sellerops.sync.SyncJob;
import java.time.Instant;
import java.util.UUID;

/**
 * One run in the unified history — extends the legacy {@code SyncJobView} shape
 * with the scheduled-collection fields (trigger, data type, attempt, rate
 * limit). Upload runs appear here too ({@code trigger=UPLOAD}, null
 * sellerAccountId/dataType); the legacy {@code /api/sync-jobs} stays untouched.
 */
public record SyncRunView(
        UUID id,
        UUID sellerAccountId,
        UUID channelId,
        String dataType,
        String trigger,
        int attempt,
        boolean rateLimited,
        Instant nextRetryAt,
        String jobType,
        String uploadType,
        String status,
        int totalRows,
        int successRows,
        int skippedRows,
        int failedRows,
        String errorMessage,
        Instant startedAt,
        Instant finishedAt,
        /**
         * How the rows were obtained — {@code API}, {@code FILE_UPLOAD}, {@code SELLER_CENTER_READ}. Carried
         * because a screen read cannot be re-run through the API pull path, and the screen that offers 다시
         * 시도 must read that fact rather than infer it from the trigger. It is not rendered.
         */
        String method,
        /**
         * What this run could say about reviews it did not read — {@code null} unless it was a screen read.
         * Derived from the counts already on the row; see {@link com.sellerops.collect.ReviewCoverageSignal}.
         */
        ReviewCoverageSignal coverage) {

    public static SyncRunView from(SyncJob j) {
        return new SyncRunView(j.getId(), j.getSellerAccountId(), j.getChannelId(), j.getDataType(),
                j.getTrigger(), j.getAttempt(), j.isRateLimited(), j.getNextRetryAt(),
                j.getJobType(), j.getUploadType(), j.getStatus(), j.getTotalRows(), j.getSuccessRows(),
                j.getSkippedRows(), j.getFailedRows(), j.getErrorMessage(), j.getStartedAt(), j.getFinishedAt(),
                j.getMethod(), ReviewCoverageSignal.of(j));
    }
}
