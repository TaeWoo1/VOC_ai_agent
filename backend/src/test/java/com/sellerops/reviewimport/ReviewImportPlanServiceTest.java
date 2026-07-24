package com.sellerops.reviewimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.common.ApiException;
import com.sellerops.reviewimport.ReviewImportSegmentPlanner.DateRange;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Planning + reshaping logic, repositories mocked (no DB, no FK seeding). Pins: monthly generation, and
 * the fail-closed guards on split (exact tiling) and merge (contiguous, not-yet-run) that keep an operator
 * from carving gaps into the plan or merging away a run.
 */
class ReviewImportPlanServiceTest {

    private final ReviewImportPlanRepository plans = mock(ReviewImportPlanRepository.class);
    private final ReviewImportSegmentRepository segments = mock(ReviewImportSegmentRepository.class);
    private final ReviewImportPlanService service = new ReviewImportPlanService(plans, segments);

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final UUID planId = UUID.randomUUID();

    private static DateRange r(String s, String e) {
        return new DateRange(LocalDate.parse(s), LocalDate.parse(e));
    }

    private ReviewImportSegment seg(UUID id, String start, String end, SegmentExecutionState exec) {
        ReviewImportSegment s = new ReviewImportSegment();
        s.setId(id);
        s.setPlanId(planId);
        s.setOrgId(org);
        s.setSegmentStart(LocalDate.parse(start));
        s.setSegmentEnd(LocalDate.parse(end));
        s.setExecutionState(exec);
        s.setCoverageState(SegmentCoverageState.UNVERIFIED);
        return s;
    }

    private void stubSaves() {
        when(plans.save(any())).thenAnswer(inv -> {
            ReviewImportPlan p = inv.getArgument(0);
            if (p.getId() == null) {
                p.setId(planId);
            }
            return p;
        });
        when(segments.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private void stubRecompute() {
        ReviewImportPlan p = new ReviewImportPlan();
        p.setId(planId);
        p.setStatus(ReviewImportPlanStatus.DRAFT);
        when(plans.findById(planId)).thenReturn(Optional.of(p));
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId)).thenReturn(List.of());
    }

    @Test
    void createPlanPersistsOneSegmentPerCalendarMonth() {
        stubSaves();
        service.createPlan(org, account, channel, LocalDate.parse("2026-01-10"), LocalDate.parse("2026-03-05"));

        ArgumentCaptor<ReviewImportSegment> cap = ArgumentCaptor.forClass(ReviewImportSegment.class);
        verify(segments, times(3)).save(cap.capture());
        List<ReviewImportSegment> saved = cap.getAllValues();
        assertThat(saved).allSatisfy(s -> {
            assertThat(s.getExecutionState()).isEqualTo(SegmentExecutionState.PENDING);
            assertThat(s.getCoverageState()).isEqualTo(SegmentCoverageState.UNVERIFIED);
            assertThat(s.isSuperseded()).isFalse();
        });
        assertThat(saved).extracting(ReviewImportSegment::getSegmentStart, ReviewImportSegment::getSegmentEnd)
                .containsExactly(
                        Tuple.tuple(LocalDate.parse("2026-01-10"), LocalDate.parse("2026-01-31")),
                        Tuple.tuple(LocalDate.parse("2026-02-01"), LocalDate.parse("2026-02-28")),
                        Tuple.tuple(LocalDate.parse("2026-03-01"), LocalDate.parse("2026-03-05")));
    }

    @Test
    void splitTilesTheParentAndSupersedesIt() {
        stubSaves();
        stubRecompute();
        UUID segId = UUID.randomUUID();
        ReviewImportSegment parent = seg(segId, "2026-03-01", "2026-03-31", SegmentExecutionState.FAILED);
        when(segments.findByIdAndOrgId(segId, org)).thenReturn(Optional.of(parent));

        List<ReviewImportSegment> children = service.splitSegment(org, segId,
                List.of(r("2026-03-01", "2026-03-15"), r("2026-03-16", "2026-03-31")));

        assertThat(parent.isSuperseded()).isTrue();
        assertThat(children).hasSize(2);
        assertThat(children).allSatisfy(c -> {
            assertThat(c.getParentSegmentId()).isEqualTo(segId);
            assertThat(c.getExecutionState()).isEqualTo(SegmentExecutionState.PENDING);
        });
    }

    @Test
    void splitRejectsChildrenThatDoNotCoverTheParentExactly() {
        stubSaves();
        UUID segId = UUID.randomUUID();
        when(segments.findByIdAndOrgId(segId, org))
                .thenReturn(Optional.of(seg(segId, "2026-03-01", "2026-03-31", SegmentExecutionState.PENDING)));

        // gap between 03-15 and 03-20
        assertThatThrownBy(() -> service.splitSegment(org, segId,
                List.of(r("2026-03-01", "2026-03-15"), r("2026-03-20", "2026-03-31"))))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void splitRejectsASingleChild() {
        UUID segId = UUID.randomUUID();
        when(segments.findByIdAndOrgId(segId, org))
                .thenReturn(Optional.of(seg(segId, "2026-03-01", "2026-03-31", SegmentExecutionState.PENDING)));
        assertThatThrownBy(() -> service.splitSegment(org, segId, List.of(r("2026-03-01", "2026-03-31"))))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void mergeCombinesContiguousPendingSegments() {
        stubSaves();
        stubRecompute();
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        when(segments.findByIdAndOrgId(a, org))
                .thenReturn(Optional.of(seg(a, "2026-01-01", "2026-01-31", SegmentExecutionState.PENDING)));
        when(segments.findByIdAndOrgId(b, org))
                .thenReturn(Optional.of(seg(b, "2026-02-01", "2026-02-28", SegmentExecutionState.PENDING)));

        ReviewImportSegment merged = service.mergeSegments(org, List.of(b, a));
        assertThat(merged.getSegmentStart()).isEqualTo(LocalDate.parse("2026-01-01"));
        assertThat(merged.getSegmentEnd()).isEqualTo(LocalDate.parse("2026-02-28"));
    }

    @Test
    void mergeRejectsNonContiguousSegments() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        when(segments.findByIdAndOrgId(a, org))
                .thenReturn(Optional.of(seg(a, "2026-01-01", "2026-01-31", SegmentExecutionState.PENDING)));
        when(segments.findByIdAndOrgId(b, org))
                .thenReturn(Optional.of(seg(b, "2026-03-01", "2026-03-31", SegmentExecutionState.PENDING)));
        assertThatThrownBy(() -> service.mergeSegments(org, List.of(a, b))).isInstanceOf(ApiException.class);
    }

    @Test
    void mergeRejectsAlreadyRunSegments() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        when(segments.findByIdAndOrgId(a, org))
                .thenReturn(Optional.of(seg(a, "2026-01-01", "2026-01-31", SegmentExecutionState.PENDING)));
        when(segments.findByIdAndOrgId(b, org))
                .thenReturn(Optional.of(seg(b, "2026-02-01", "2026-02-28", SegmentExecutionState.COMPLETED)));
        assertThatThrownBy(() -> service.mergeSegments(org, List.of(a, b))).isInstanceOf(ApiException.class);
    }
}
