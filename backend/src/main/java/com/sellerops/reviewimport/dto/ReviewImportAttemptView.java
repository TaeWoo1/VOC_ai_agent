package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportSegmentAttempt;
import java.time.Instant;
import java.util.UUID;

/**
 * One export+ingest attempt (retry history), sanitized to counts + outcome + timing.
 *
 * <p>{@code scopeEvidence} travels alongside {@code scopeConfirmed} rather than replacing it: the boolean
 * says the scope was confirmed, the evidence says by whom/how (a guided run's read-back versus an operator
 * attestation). Null on attempts predating the column. The UI must not render an operator confirmation as
 * a machine check.
 */
public record ReviewImportAttemptView(
        int attemptNo,
        String result,
        UUID syncJobId,
        boolean scopeConfirmed,
        String scopeEvidence,
        Integer rowsNew,
        Integer rowsDuplicate,
        Integer rowsFailed,
        String errorMessage,
        Instant startedAt,
        Instant finishedAt) {

    public static ReviewImportAttemptView from(ReviewImportSegmentAttempt a) {
        return new ReviewImportAttemptView(a.getAttemptNo(), a.getResult().name(), a.getSyncJobId(),
                a.isScopeConfirmed(),
                a.getScopeEvidence() == null ? null : a.getScopeEvidence().name(),
                a.getRowsNew(), a.getRowsDuplicate(), a.getRowsFailed(),
                a.getErrorMessage(), a.getStartedAt(), a.getFinishedAt());
    }
}
