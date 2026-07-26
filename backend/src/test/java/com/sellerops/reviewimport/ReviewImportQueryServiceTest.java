package com.sellerops.reviewimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.reviewimport.dto.ReviewImportHealthView;
import com.sellerops.reviewimport.dto.ReviewImportPlanDetailView;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Import-health aggregation: coverage baseline + missing ranges from segments, new/duplicate/failed from
 * each segment's LATEST attempt (a retry replaces, never double-counts), and the next recommended import
 * (finish remaining work first, else go incremental from the baseline).
 */
class ReviewImportQueryServiceTest {

    private final ReviewImportPlanRepository plans = mock(ReviewImportPlanRepository.class);
    private final ReviewImportSegmentRepository segments = mock(ReviewImportSegmentRepository.class);
    private final ReviewImportSegmentAttemptRepository attempts = mock(ReviewImportSegmentAttemptRepository.class);
    private final ReviewImportQueryService service = new ReviewImportQueryService(plans, segments, attempts);

    private final UUID orgId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID planId = UUID.randomUUID();

    private ReviewImportSegment seg(UUID id, String start, String end, SegmentCoverageState cov, Integer rows) {
        ReviewImportSegment s = new ReviewImportSegment();
        s.setId(id);
        s.setPlanId(planId);
        s.setOrgId(orgId);
        s.setSegmentStart(LocalDate.parse(start));
        s.setSegmentEnd(LocalDate.parse(end));
        s.setCoverageState(cov);
        s.setCoveredRows(rows);
        // A segment still needing work is PENDING (remaining); a covered/missing one is COMPLETED (not
        // remaining). This is what `selectNextRemaining` filters on.
        s.setExecutionState(cov == SegmentCoverageState.UNVERIFIED
                ? SegmentExecutionState.PENDING
                : SegmentExecutionState.COMPLETED);
        return s;
    }

    private ReviewImportSegmentAttempt attempt(int no, SegmentAttemptResult res, int nw, int dup, int failed) {
        ReviewImportSegmentAttempt a = new ReviewImportSegmentAttempt();
        a.setAttemptNo(no);
        a.setResult(res);
        a.setRowsNew(nw);
        a.setRowsDuplicate(dup);
        a.setRowsFailed(failed);
        return a;
    }

    @Test
    void healthAggregatesLatestAttemptRowsAndRecommendsRemainingFirst() {
        ReviewImportPlan plan = new ReviewImportPlan();
        plan.setId(planId);
        when(plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, accountId)).thenReturn(List.of(plan));

        UUID covered = UUID.randomUUID();
        UUID remaining = UUID.randomUUID();
        UUID missing = UUID.randomUUID();
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId)).thenReturn(List.of(
                seg(missing, "2025-11-01", "2025-11-30", SegmentCoverageState.MISSING, null),
                seg(covered, "2025-12-01", "2025-12-31", SegmentCoverageState.COVERED, 8),
                seg(remaining, "2026-01-01", "2026-01-31", SegmentCoverageState.UNVERIFIED, null)));

        // covered segment: a first attempt failed, then a retry succeeded — only the LATEST counts.
        when(attempts.findBySegmentIdOrderByAttemptNoAsc(covered)).thenReturn(List.of(
                attempt(1, SegmentAttemptResult.FAILED, 0, 0, 0),
                attempt(2, SegmentAttemptResult.SUCCEEDED, 6, 2, 0)));
        when(attempts.findBySegmentIdOrderByAttemptNoAsc(remaining)).thenReturn(List.of());
        when(attempts.findBySegmentIdOrderByAttemptNoAsc(missing)).thenReturn(List.of());

        ReviewImportHealthView health = service.health(orgId, accountId);

        assertThat(health.lastCoveredDate()).isEqualTo(LocalDate.parse("2025-12-31"));
        assertThat(health.newCount()).isEqualTo(6);      // latest attempt only, not 0+6
        assertThat(health.duplicateCount()).isEqualTo(2);
        assertThat(health.failedCount()).isZero();
        assertThat(health.missingRanges()).hasSize(1);
        assertThat(health.missingRanges().get(0).start()).isEqualTo(LocalDate.parse("2025-11-01"));
        // remaining work exists → recommend its earliest start, not the incremental next day.
        assertThat(health.nextRecommendedImport()).isEqualTo(LocalDate.parse("2026-01-01"));
    }

    @Test
    void whenNothingRemainsRecommendsTheDayAfterTheBaseline() {
        ReviewImportPlan plan = new ReviewImportPlan();
        plan.setId(planId);
        when(plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, accountId)).thenReturn(List.of(plan));
        UUID covered = UUID.randomUUID();
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId)).thenReturn(List.of(
                seg(covered, "2026-01-01", "2026-01-31", SegmentCoverageState.COVERED, 3)));
        when(attempts.findBySegmentIdOrderByAttemptNoAsc(covered)).thenReturn(List.of(
                attempt(1, SegmentAttemptResult.SUCCEEDED, 3, 0, 0)));

        ReviewImportHealthView health = service.health(orgId, accountId);
        assertThat(health.nextRecommendedImport()).isEqualTo(LocalDate.parse("2026-02-01"));
    }

    /**
     * AR-ORD: the plan detail's {@code nextSegmentId} is the SAME segment the mint would ticket — one rule
     * ({@link ReviewImportLaunchService#selectNextRemaining}) drives both, so the card shows exactly the segment
     * the ticket authorizes and can never name a different month.
     */
    @Test
    void planDetailNextSegmentIsTheSameSegmentTheMintWouldTicket() {
        ReviewImportPlan plan = new ReviewImportPlan();
        plan.setId(planId);
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan));

        UUID olderRemaining = UUID.randomUUID();
        UUID coveredMiddle = UUID.randomUUID();
        UUID newerRemaining = UUID.randomUUID();
        List<ReviewImportSegment> ordered = List.of(
                seg(olderRemaining, "2026-01-01", "2026-01-31", SegmentCoverageState.UNVERIFIED, null),
                seg(coveredMiddle, "2026-02-01", "2026-02-28", SegmentCoverageState.COVERED, 5),
                seg(newerRemaining, "2026-03-01", "2026-03-31", SegmentCoverageState.UNVERIFIED, null));
        when(segments.findByPlanIdOrderBySegmentStartAsc(planId)).thenReturn(ordered);

        ReviewImportPlanDetailView detail = service.planDetail(orgId, planId);

        // Newest remaining wins — and it is exactly what the mint's own selector returns.
        assertThat(detail.nextSegmentId()).isEqualTo(newerRemaining);
        assertThat(detail.nextSegmentId()).isEqualTo(
                ReviewImportLaunchService.selectNextRemaining(ordered)
                        .map(ReviewImportSegment::getId)
                        .orElseThrow());
    }

    @Test
    void planDetailNextSegmentIsNullWhenNothingRemains() {
        ReviewImportPlan plan = new ReviewImportPlan();
        plan.setId(planId);
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan));
        when(segments.findByPlanIdOrderBySegmentStartAsc(planId)).thenReturn(List.of(
                seg(UUID.randomUUID(), "2026-01-01", "2026-01-31", SegmentCoverageState.COVERED, 3),
                seg(UUID.randomUUID(), "2026-02-01", "2026-02-28", SegmentCoverageState.MISSING, null)));

        assertThat(service.planDetail(orgId, planId).nextSegmentId()).isNull();
    }
}
