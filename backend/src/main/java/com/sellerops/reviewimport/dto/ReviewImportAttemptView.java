package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportSegmentAttempt;
import java.time.Instant;
import java.util.UUID;

/** One export+ingest attempt (retry history), sanitized to counts + outcome + timing. */
public record ReviewImportAttemptView(
        int attemptNo,
        String result,
        UUID syncJobId,
        boolean scopeConfirmed,
        Integer rowsNew,
        Integer rowsDuplicate,
        Integer rowsFailed,
        String errorMessage,
        Instant startedAt,
        Instant finishedAt) {

    public static ReviewImportAttemptView from(ReviewImportSegmentAttempt a) {
        return new ReviewImportAttemptView(a.getAttemptNo(), a.getResult().name(), a.getSyncJobId(),
                a.isScopeConfirmed(), a.getRowsNew(), a.getRowsDuplicate(), a.getRowsFailed(),
                a.getErrorMessage(), a.getStartedAt(), a.getFinishedAt());
    }
}
