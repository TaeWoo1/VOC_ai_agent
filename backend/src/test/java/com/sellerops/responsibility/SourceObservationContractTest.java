package com.sellerops.responsibility;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.sync.SyncJob;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The observation contract (§6-2) and the run outcome rule (R3/R4), without a database.
 *
 * <p>The sentence all of these protect: «0건 관측» and «확인하지 못함» are never the same state.
 */
class SourceObservationContractTest {

    private static SyncJob job(String status, int success, int skipped, int failed, String failureCode,
                               Integer inserted) {
        SyncJob job = new SyncJob();
        job.setId(UUID.randomUUID());
        job.setJobType("CAFE24_API");
        job.setStatus(status);
        job.setSuccessRows(success);
        job.setSkippedRows(skipped);
        job.setFailedRows(failed);
        job.setTotalRows(success + skipped + failed);
        job.setFailureCode(failureCode);
        job.setInsertedRows(inserted);
        job.setFinishedAt(Instant.parse("2026-09-15T13:00:05Z"));
        return job;
    }

    @Test
    void aCleanRunThatFoundNothingNewIsCompleteWithARealZero() {
        SourceObservation o = SourceObservationMapper.fromJob(job("SUCCESS", 0, 0, 0, null, 0),
                ChannelStatus.CONNECTED, "c1", "c1");
        assertThat(o.completeness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(o.observedCount()).isZero();
        assertThat(o.newCount()).isZero();
        assertThat(o.changedCount()).isZero();
        assertThat(o.failureReason()).isNull();
        assertThat(o.observedAt()).isNotNull();
    }

    @Test
    void newIsInsertedRowsNotSuccessRows_becauseSuccessAlsoCountsUpdates() {
        SourceObservation o = SourceObservationMapper.fromJob(job("SUCCESS", 5, 3, 0, null, 2),
                ChannelStatus.CONNECTED, null, null);
        assertThat(o.observedCount()).isEqualTo(8);
        assertThat(o.newCount()).isEqualTo(2);
        assertThat(o.changedCount()).isEqualTo(3);
    }

    @Test
    void anAdoptedJobThisRuntimeDidNotRunReportsNewAndChangedAsUnknown() {
        SourceObservation o = SourceObservationMapper.fromJob(job("SUCCESS", 5, 3, 0, null, null),
                ChannelStatus.CONNECTED, null, null);
        assertThat(o.observedCount()).isEqualTo(8);
        assertThat(o.newCount()).isNull();
        assertThat(o.changedCount()).isNull();
    }

    @Test
    void authFailureWithNothingReadIsNoneWithoutACount() {
        SourceObservation o = SourceObservationMapper.fromJob(job("FAILED", 0, 0, 0, "AUTH_REQUIRED", 0),
                ChannelStatus.RECONNECT_REQUIRED, null, null);
        assertThat(o.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(o.failureReason()).isEqualTo(SourceFailureReason.AUTH_REQUIRED);
        assertThat(o.observedCount()).isNull();
        assertThat(o.newCount()).isNull();
        assertThat(o.changedCount()).isNull();
        assertThat(o.observedAt()).isNull();
    }

    @Test
    void timeoutIsNoneAndRetryable() {
        SourceObservation o = SourceObservationMapper.fromJob(job("FAILED", 0, 0, 0, "TIMEOUT", 0),
                ChannelStatus.CONNECTED, null, null);
        assertThat(o.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(o.failureReason()).isEqualTo(SourceFailureReason.TIMEOUT);
        assertThat(o.failureReason().retryable()).isTrue();
        assertThat(o.observedCount()).isNull();
    }

    @Test
    void anAuthVerdictInferredFromTheAccountWhenTheJobCarriesNoCode() {
        SourceObservation o = SourceObservationMapper.fromJob(job("FAILED", 0, 0, 0, null, null),
                ChannelStatus.RECONNECT_REQUIRED, null, null);
        assertThat(o.failureReason()).isEqualTo(SourceFailureReason.AUTH_REQUIRED);
    }

    @Test
    void aRateLimitAfterSomeRowsIsPartialWithTheFactualCountOfThisRead() {
        SyncJob j = job("PARTIAL", 50, 0, 0, "RATE_LIMITED", 50);
        j.setRateLimited(true);
        SourceObservation o = SourceObservationMapper.fromJob(j, ChannelStatus.CONNECTED, null, null);
        assertThat(o.completeness()).isEqualTo(SourceCompleteness.PARTIAL);
        assertThat(o.observedCount()).isEqualTo(50);
        assertThat(o.failureReason()).isEqualTo(SourceFailureReason.RATE_LIMITED);
    }

    @Test
    void thePageGuardIsAnExplicitBound() {
        SourceObservation o = SourceObservationMapper.fromJob(job("PARTIAL", 10, 0, 0, "PAGE_LIMIT_REACHED", 10),
                ChannelStatus.CONNECTED, null, null);
        assertThat(o.completeness()).isEqualTo(SourceCompleteness.BOUNDED);
        assertThat(o.observedCount()).isEqualTo(10);
        assertThat(o.completeness().settled()).isTrue();
    }

    @Test
    void rowsThatArrivedButCouldNotBeKeptArePartialNotNone() {
        SourceObservation o = SourceObservationMapper.fromJob(job("FAILED", 0, 0, 3, "EXECUTION_FAILED", 0),
                ChannelStatus.CONNECTED, null, null);
        assertThat(o.completeness()).isEqualTo(SourceCompleteness.PARTIAL);
        assertThat(o.observedCount()).isEqualTo(3);
    }

    @Test
    void theRecordRefusesACountOnNoneAndAReasonlessNone() {
        assertThatThrownBy(() -> new SourceObservation(SourceCompleteness.NONE, 0, null, null,
                SourceFailureReason.TIMEOUT, null, null, null, null, null, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new SourceObservation(SourceCompleteness.NONE, null, null, null,
                null, null, null, null, null, null, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new SourceObservation(SourceCompleteness.COMPLETE, 0, 0, 0,
                SourceFailureReason.TIMEOUT, null, null, null, null, null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void runOutcomeRule() {
        assertThat(RunOutcomeRule.of(List.of(SourceCompleteness.COMPLETE, SourceCompleteness.COMPLETE)))
                .isEqualTo(RunStatus.SUCCESS);
        assertThat(RunOutcomeRule.of(List.of(SourceCompleteness.COMPLETE, SourceCompleteness.BOUNDED)))
                .isEqualTo(RunStatus.SUCCESS);
        // one source failure + one success → PARTIAL
        assertThat(RunOutcomeRule.of(List.of(SourceCompleteness.COMPLETE, SourceCompleteness.NONE)))
                .isEqualTo(RunStatus.PARTIAL);
        assertThat(RunOutcomeRule.of(List.of(SourceCompleteness.PARTIAL, SourceCompleteness.COMPLETE)))
                .isEqualTo(RunStatus.PARTIAL);
        // all required sources failed → FAILED
        assertThat(RunOutcomeRule.of(List.of(SourceCompleteness.NONE, SourceCompleteness.NONE)))
                .isEqualTo(RunStatus.FAILED);
        assertThat(RunOutcomeRule.of(List.of())).isEqualTo(RunStatus.FAILED);
    }
}
