package com.sellerops.responsibility;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.sync.SyncJob;

/**
 * Reads a finished {@link SyncJob} — the existing acquisition's own record — as an observation fact.
 *
 * <p>Two numbers the job does not persist are only known when this runtime ran the job itself
 * ({@link SyncJob#getInsertedRows()} is transient): a job adopted from another trigger reports {@code newCount} and
 * {@code changedCount} as null, because {@code success_rows} counts in-place updates too and presenting it as
 * «new» would be a number nobody measured.
 */
final class SourceObservationMapper {

    static final String PAGE_LIMIT_REACHED = "PAGE_LIMIT_REACHED";

    private SourceObservationMapper() {
    }

    static SourceObservation fromJob(SyncJob job, ChannelStatus accountStatusAfter, String cursorFrom, String cursorTo) {
        String recipe = job.getJobType();
        String status = job.getStatus();
        if (status == null || "RUNNING".equals(status)) {
            // Not finished: nothing was established yet.
            return SourceObservation.none(SourceFailureReason.TIMEOUT, job.getId(), recipe);
        }
        int total = job.getTotalRows();
        Integer inserted = job.getInsertedRows();
        Integer newCount = inserted;
        Integer changed = inserted == null ? null : Math.max(job.getSuccessRows() - inserted, 0);

        if (PAGE_LIMIT_REACHED.equals(job.getFailureCode())) {
            // The read stopped at the executor's page guard: an explicit bound, recorded as such.
            return new SourceObservation(SourceCompleteness.BOUNDED, total, newCount, changed, null,
                    IdentityVerdict.NOT_APPLICABLE, recipe, job.getFinishedAt(), job.getId(), cursorFrom, cursorTo);
        }
        switch (status) {
            case "SUCCESS":
                return new SourceObservation(SourceCompleteness.COMPLETE, total, newCount, changed, null,
                        IdentityVerdict.NOT_APPLICABLE, recipe, job.getFinishedAt(), job.getId(), cursorFrom, cursorTo);
            case "PARTIAL":
                return new SourceObservation(SourceCompleteness.PARTIAL, total, newCount, changed,
                        classify(job, accountStatusAfter), IdentityVerdict.NOT_APPLICABLE, recipe,
                        job.getFinishedAt(), job.getId(), cursorFrom, cursorTo);
            default:
                if (total > 0) {
                    // Rows arrived and none could be kept: observed, not complete.
                    return new SourceObservation(SourceCompleteness.PARTIAL, total, newCount, changed,
                            classify(job, accountStatusAfter), IdentityVerdict.NOT_APPLICABLE, recipe,
                            job.getFinishedAt(), job.getId(), cursorFrom, cursorTo);
                }
                SourceObservation none = SourceObservation.none(classify(job, accountStatusAfter), job.getId(), recipe);
                return new SourceObservation(none.completeness(), null, null, null, none.failureReason(),
                        none.identityVerdict(), recipe, null, job.getId(), cursorFrom, cursorTo);
        }
    }

    static SourceFailureReason classify(SyncJob job, ChannelStatus accountStatusAfter) {
        String code = job.getFailureCode();
        if (code != null) {
            switch (code) {
                case "AUTH_REQUIRED":
                    return SourceFailureReason.AUTH_REQUIRED;
                case "TIMEOUT":
                    return SourceFailureReason.TIMEOUT;
                case "RATE_LIMITED":
                    return SourceFailureReason.RATE_LIMITED;
                case "CONNECTOR_UNAVAILABLE":
                    return SourceFailureReason.CONNECTOR_UNAVAILABLE;
                case "CONFIGURATION_REQUIRED":
                    return SourceFailureReason.CONFIGURATION_REQUIRED;
                default:
                    break;
            }
        }
        if (job.isRateLimited()) {
            return SourceFailureReason.RATE_LIMITED;
        }
        if (accountStatusAfter == ChannelStatus.RECONNECT_REQUIRED) {
            return SourceFailureReason.AUTH_REQUIRED;
        }
        return SourceFailureReason.EXECUTION_FAILED;
    }
}
