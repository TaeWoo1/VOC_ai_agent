package com.sellerops.reviewimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.common.ApiException;
import com.sellerops.connector.FileUploadConnector;
import com.sellerops.ingest.IngestResult;
import com.sellerops.ingest.UploadType;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Segment run lifecycle, with the upload connector + repositories mocked. Pins: the scope-confirmation
 * gate, execution/coverage transitions on success (incl. a valid empty) and on a failed ingest (execution
 * FAILED, coverage untouched), and that a failed attempt is recorded (retryable) rather than lost.
 */
class ReviewImportRunServiceTest {

    private final ReviewImportPlanRepository plans = mock(ReviewImportPlanRepository.class);
    private final ReviewImportSegmentRepository segments = mock(ReviewImportSegmentRepository.class);
    private final ReviewImportSegmentAttemptRepository attempts = mock(ReviewImportSegmentAttemptRepository.class);
    private final FileUploadConnector uploadConnector = mock(FileUploadConnector.class);
    private final ReviewImportPlanService planService = mock(ReviewImportPlanService.class);
    private final ReviewImportRunService service =
            new ReviewImportRunService(plans, segments, attempts, uploadConnector, planService);

    private final UUID orgId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private final UUID planId = UUID.randomUUID();
    private final UUID segId = UUID.randomUUID();

    private ReviewImportSegment pendingSegment() {
        ReviewImportSegment s = new ReviewImportSegment();
        s.setId(segId);
        s.setPlanId(planId);
        s.setOrgId(orgId);
        s.setSegmentStart(LocalDate.parse("2026-03-01"));
        s.setSegmentEnd(LocalDate.parse("2026-03-31"));
        s.setExecutionState(SegmentExecutionState.PENDING);
        s.setCoverageState(SegmentCoverageState.UNVERIFIED);
        return s;
    }

    private void stubCommon(ReviewImportSegment segment) {
        when(segments.findByIdAndOrgId(segId, orgId)).thenReturn(Optional.of(segment));
        when(segments.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(attempts.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(attempts.nextAttemptNo(segId)).thenReturn(1);
        ReviewImportPlan plan = new ReviewImportPlan();
        plan.setId(planId);
        plan.setChannelId(channelId);
        when(plans.findById(planId)).thenReturn(Optional.of(plan));
    }

    private IngestResult ingest(String status, int newRows, int dup, int failed, String err) {
        return new IngestResult(UUID.randomUUID(), UploadType.REVIEW, status, newRows + dup + failed,
                newRows, dup, failed, err, List.of());
    }

    private static InputStream file() {
        return new ByteArrayInputStream("synthetic".getBytes());
    }

    @Test
    void successMarksCompletedAndCoveredWithNewPlusDuplicateRows() {
        ReviewImportSegment segment = pendingSegment();
        stubCommon(segment);
        when(uploadConnector.ingest(eq(orgId), eq(channelId), eq(UploadType.REVIEW), any(), any(), any()))
                .thenReturn(ingest("SUCCESS", 5, 2, 0, null));

        ReviewImportSegmentAttempt attempt = service.importSegment(orgId, segId, true, "export.xlsx", file());

        assertThat(attempt.getResult()).isEqualTo(SegmentAttemptResult.SUCCEEDED);
        assertThat(attempt.getSyncJobId()).isNotNull();
        assertThat(attempt.isScopeConfirmed()).isTrue();
        assertThat(segment.getExecutionState()).isEqualTo(SegmentExecutionState.COMPLETED);
        assertThat(segment.getCoverageState()).isEqualTo(SegmentCoverageState.COVERED);
        assertThat(segment.getCoveredRows()).isEqualTo(7);
        assertThat(segment.isRowsReconciled()).isFalse();
        verify(planService).recomputePlanStatus(planId);
    }

    @Test
    void validEmptyExportIsCompletedAndCoveredWithZeroRows() {
        ReviewImportSegment segment = pendingSegment();
        stubCommon(segment);
        when(uploadConnector.ingest(any(), any(), any(), any(), any(), any()))
                .thenReturn(ingest("SUCCESS", 0, 0, 0, null));

        service.importSegment(orgId, segId, true, "export.xlsx", file());

        assertThat(segment.getExecutionState()).isEqualTo(SegmentExecutionState.COMPLETED);
        assertThat(segment.getCoverageState()).isEqualTo(SegmentCoverageState.COVERED);
        assertThat(segment.getCoveredRows()).isZero();
    }

    @Test
    void failedIngestMarksExecutionFailedAndLeavesCoverageUnverified() {
        ReviewImportSegment segment = pendingSegment();
        stubCommon(segment);
        when(uploadConnector.ingest(any(), any(), any(), any(), any(), any()))
                .thenReturn(ingest("FAILED", 0, 0, 0, "파일을 처리하지 못했습니다"));

        ReviewImportSegmentAttempt attempt = service.importSegment(orgId, segId, true, "bad.xlsx", file());

        assertThat(attempt.getResult()).isEqualTo(SegmentAttemptResult.FAILED);
        assertThat(attempt.getErrorMessage()).isNotBlank();
        assertThat(segment.getExecutionState()).isEqualTo(SegmentExecutionState.FAILED);
        assertThat(segment.getCoverageState()).isEqualTo(SegmentCoverageState.UNVERIFIED);
    }

    @Test
    void refusesWithoutScopeConfirmationAndNeverIngests() {
        ReviewImportSegment segment = pendingSegment();
        when(segments.findByIdAndOrgId(segId, orgId)).thenReturn(Optional.of(segment));

        assertThatThrownBy(() -> service.importSegment(orgId, segId, false, "export.xlsx", file()))
                .isInstanceOf(ApiException.class);
        verify(uploadConnector, never()).ingest(any(), any(), any(), any(), any(), any());
        verify(attempts, never()).save(any());
    }

    @Test
    void refusesASupersededSegment() {
        ReviewImportSegment segment = pendingSegment();
        segment.setSuperseded(true);
        when(segments.findByIdAndOrgId(segId, orgId)).thenReturn(Optional.of(segment));
        assertThatThrownBy(() -> service.importSegment(orgId, segId, true, "export.xlsx", file()))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void markMissingSetsCoverageMissingWithoutAFailedAttempt() {
        ReviewImportSegment segment = pendingSegment();
        when(segments.findByIdAndOrgId(segId, orgId)).thenReturn(Optional.of(segment));
        when(segments.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ReviewImportSegment out = service.markMissing(orgId, segId);
        assertThat(out.getCoverageState()).isEqualTo(SegmentCoverageState.MISSING);
        assertThat(out.getExecutionState()).isEqualTo(SegmentExecutionState.COMPLETED); // terminal conclusion
        verify(planService).recomputePlanStatus(planId);
    }
}
