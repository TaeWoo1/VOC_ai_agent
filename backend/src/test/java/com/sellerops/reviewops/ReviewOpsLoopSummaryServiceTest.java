package com.sellerops.reviewops;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.reviewimport.ReviewImportQueryService;
import com.sellerops.reviewimport.dto.DateRangeView;
import com.sellerops.reviewimport.dto.ReviewImportHealthView;
import com.sellerops.reviewissue.ReviewIssueQueryService;
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
    private final ReviewOpsLoopSummaryService service = new ReviewOpsLoopSummaryService(imports, issues);

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
        assertThat(v.issueChange().workingTotal()).isEqualTo(4);
        assertThat(v.issueChange().needsReview()).isEqualTo(1);
        assertThat(v.issueChange().newlyRaised()).isEqualTo(1);
        assertThat(v.issueChange().surging()).isEqualTo(2);
        assertThat(v.issueChange().persistent()).isEqualTo(1);
        assertThat(v.issueChange().concentrated()).isEqualTo(1);
        assertThat(v.issueChange().improved()).isEqualTo(1);
    }

    @Test
    void notUpToDateWhenRangesAreStillMissing() {
        when(imports.health(org, account)).thenReturn(new ReviewImportHealthView(
                LocalDate.parse("2026-03-31"),
                List.of(new DateRangeView(LocalDate.parse("2026-04-01"), LocalDate.parse("2026-04-30"))),
                0, 0, 0, LocalDate.parse("2026-04-01")));
        when(issues.list(org, ref, false)).thenReturn(List.of());

        ReviewOpsLoopSummaryView v = service.summary(org, account, ref);

        assertThat(v.upToDate()).isFalse();
        assertThat(v.nextRecommendedImport()).isEqualTo(LocalDate.parse("2026-04-01"));
        assertThat(v.issueChange().workingTotal()).isZero();
    }
}
