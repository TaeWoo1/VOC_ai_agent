package com.sellerops.sync;

import java.time.Instant;
import java.util.UUID;

public record SyncJobView(
        UUID id,
        UUID channelId,
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

    static SyncJobView from(SyncJob j) {
        return new SyncJobView(j.getId(), j.getChannelId(), j.getJobType(), j.getUploadType(),
                j.getStatus(), j.getTotalRows(), j.getSuccessRows(), j.getSkippedRows(),
                j.getFailedRows(), j.getErrorMessage(), j.getStartedAt(), j.getFinishedAt());
    }
}
