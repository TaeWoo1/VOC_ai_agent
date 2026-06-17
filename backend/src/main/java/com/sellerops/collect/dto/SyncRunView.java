package com.sellerops.collect.dto;

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
        Instant finishedAt) {

    public static SyncRunView from(SyncJob j) {
        return new SyncRunView(j.getId(), j.getSellerAccountId(), j.getChannelId(), j.getDataType(),
                j.getTrigger(), j.getAttempt(), j.isRateLimited(), j.getNextRetryAt(),
                j.getJobType(), j.getUploadType(), j.getStatus(), j.getTotalRows(), j.getSuccessRows(),
                j.getSkippedRows(), j.getFailedRows(), j.getErrorMessage(), j.getStartedAt(), j.getFinishedAt());
    }
}
