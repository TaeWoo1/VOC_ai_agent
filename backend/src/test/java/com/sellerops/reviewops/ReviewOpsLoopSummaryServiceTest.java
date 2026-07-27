package com.sellerops.reviewops;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.reviewimport.ReviewImportQueryService;
import com.sellerops.reviewimport.dto.DateRangeView;
import com.sellerops.reviewimport.dto.ReviewImportHealthView;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.reviewissue.ReviewIssueUnknownUnitRepository;
import com.sellerops.reviewissue.dto.IssueChangeView;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import com.sellerops.reviewops.dto.ReviewOpsLoopSummaryView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The loop summary is a pure composition of two projections. Pins: the collection totals pass through
 * from health, the change counts are tallied per judgement kind and per lifecycle state, and the
 * up-to-date verdict follows coverage — all without any durable state of its own.
 */
class ReviewOpsLoopSummaryServiceTest {

    private final ReviewImportQueryService imports = mock(ReviewImportQueryService.class);
    private final ReviewIssueQueryService issues = mock(ReviewIssueQueryService.class);
    private final ReviewIssueRepository issueRepo = mock(ReviewIssueRepository.class);
    private final ReviewIssueUnknownUnitRepository unknownRepo = mock(ReviewIssueUnknownUnitRepository.class);
    private final ReviewOpsLoopSummaryService service =
            new ReviewOpsLoopSummaryService(imports, issues, issueRepo, unknownRepo);

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final LocalDate ref = LocalDate.parse("2026-05-10");

    private ReviewIssueView issue(String lifecycleState, String... kinds) {
        IssueChangeView change = new IssueChangeView(List.of(kinds), List.of(), false, 0, 0.0);
        return new ReviewIssueView(UUID.randomUUID(), "제목", "배송", "느림", "MEDIUM",
                lifecycleState, "라벨", 3, ref, ref, null, null, false, "RULE_BASED", change);
    }

    @Test
    void composesCollectionTotalsAndChangeCountsAndUpToDateTrue() {
        when(imports.health(org, account)).thenReturn(new ReviewImportHealthView(
                LocalDate.parse("2026-05-09"), List.of(), 12, 4, 1,
                LocalDate.parse("2026-05-11"))); // next is AFTER ref → up to date
        when(issueRepo.existsByOrgId(org)).thenReturn(true); // extraction has run
        when(issues.list(org, ref, false)).thenReturn(List.of(
                issue("NEEDS_REVIEW", "NEW", "SURGING"),
                issue("OBSERVING", "PERSISTENT"),
                issue("OBSERVING", "IMPROVED"),
                issue("ACTING", "CONCENTRATED", "SURGING")));

        ReviewOpsLoopSummaryView v = service.summary(org, account, ref);

        assertThat(v.referenceDate()).isEqualTo(ref);
        assertThat(v.lastCoveredDate()).isEqualTo(LocalDate.parse("2026-05-09"));
        assertThat(v.newCount()).isEqualTo(12);
        assertThat(v.duplicateCount()).isEqualTo(4);
        assertThat(v.failedCount()).isEqualTo(1);
        assertThat(v.upToDate()).isTrue();
        assertThat(v.issueMemoryReady()).isTrue();
        assertThat(v.issueChange().workingTotal()).isEqualTo(4);
        assertThat(v.issueChange().needsReview()).isEqualTo(1);
        assertThat(v.issueChange().newlyRaised()).isEqualTo(1);
        assertThat(v.issueChange().surging()).isEqualTo(2);
        assertThat(v.issueChange().persistent()).isEqualTo(1);
        assertThat(v.issueChange().concentrated()).isEqualTo(1);
        assertThat(v.issueChange().improved()).isEqualTo(1);
    }

    @Test
    void notUpToDateWhenAnImportablePeriodRemains() {
        when(imports.health(org, account)).thenReturn(new ReviewImportHealthView(
                LocalDate.parse("2026-03-31"),
                List.of(new DateRangeView(LocalDate.parse("2026-04-01"), LocalDate.parse("2026-04-30"))),
                0, 0, 0, LocalDate.parse("2026-04-01"))); // next ≤ ref → work outstanding
        when(issues.list(org, ref, false)).thenReturn(List.of());

        ReviewOpsLoopSummaryView v = service.summary(org, account, ref);

        assertThat(v.upToDate()).isFalse();
        assertThat(v.nextRecommendedImport()).isEqualTo(LocalDate.parse("2026-04-01"));
        assertThat(v.issueChange().workingTotal()).isZero();
    }

    @Test
    void aConcludedMissingRangeAloneDoesNotMakeTheSummaryStale() {
        // Covered through today, with an earlier MISSING (unreachable) range — next is AFTER ref, so despite
        // a non-empty missingRanges the loop is up to date and offers no false "new period".
        when(imports.health(org, account)).thenReturn(new ReviewImportHealthView(
                ref,
                List.of(new DateRangeView(LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31"))),
                50, 0, 0, LocalDate.parse("2026-05-11"))); // next > ref
        when(issueRepo.existsByOrgId(org)).thenReturn(true);
        when(issues.list(org, ref, false)).thenReturn(List.of());

        ReviewOpsLoopSummaryView v = service.summary(org, account, ref);

        assertThat(v.upToDate()).isTrue(); // MISSING is settled, not outstanding
        assertThat(v.missingRanges()).hasSize(1); // still reported, not hidden
    }

    @Test
    void issueMemoryNotReadyWhenReviewsExistButNoIssueMemoryYet() {
        // Reviews were accounted for, but neither issues nor UNKNOWN units exist → the after-ingest refresh
        // has not run (or silently failed). This must NOT read as "no change".
        when(imports.health(org, account)).thenReturn(new ReviewImportHealthView(
                ref, List.of(), 300, 0, 0, LocalDate.parse("2026-05-11")));
        when(issueRepo.existsByOrgId(org)).thenReturn(false);
        when(unknownRepo.existsByOrgId(org)).thenReturn(false);
        when(issues.list(org, ref, false)).thenReturn(List.of());

        ReviewOpsLoopSummaryView v = service.summary(org, account, ref);

        assertThat(v.issueMemoryReady()).isFalse();
    }

    @Test
    void issueMemoryReadyWhenNoReviewsHaveBeenImportedYet() {
        // Nothing imported → nothing to analyse → trivially ready (no false "not updated" prompt).
        when(imports.health(org, account)).thenReturn(new ReviewImportHealthView(
                null, List.of(), 0, 0, 0, null));
        when(issues.list(org, ref, false)).thenReturn(List.of());

        ReviewOpsLoopSummaryView v = service.summary(org, account, ref);

        assertThat(v.issueMemoryReady()).isTrue();
        assertThat(v.upToDate()).isTrue(); // next == null
    }
}
