package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.reviewissue.IssueWindows.DateRange;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Off-by-one is the entire risk in {@link IssueWindows}, and every judgement is built on it: a
 * baseline that overlapped the window it explains would compare a surge against itself.
 */
class IssueWindowsTest {

    private static final LocalDate REF = LocalDate.of(2026, 7, 25);

    @Test
    void aSevenDayWindowEndingTodayStartsSixDaysAgo() {
        DateRange week = IssueWindows.trailing(REF, 7);

        assertThat(week.fromInclusive()).isEqualTo(LocalDate.of(2026, 7, 19));
        assertThat(week.toInclusive()).isEqualTo(REF);
        assertThat(week.fromInclusive().datesUntil(week.toInclusive().plusDays(1)).count())
                .isEqualTo(7);
    }

    @Test
    void aSingleDayWindowIsAllowed() {
        DateRange day = IssueWindows.trailing(REF, 1);
        assertThat(day.fromInclusive()).isEqualTo(REF);
        assertThat(day.toInclusive()).isEqualTo(REF);
    }

    /** The baseline must be contiguous with, and not overlap, the window it is compared against. */
    @Test
    void theSurgeBaselineAbutsTheSurgeWindowWithoutOverlapping() {
        DateRange window = IssueWindows.trailing(REF, ReviewIssueThresholds.SURGE_WINDOW_DAYS);
        DateRange baseline = IssueWindows.precedingBlock(REF,
                ReviewIssueThresholds.SURGE_WINDOW_DAYS, ReviewIssueThresholds.surgeBaselineDays());

        assertThat(baseline.toInclusive()).isEqualTo(window.fromInclusive().minusDays(1));
        assertThat(baseline.fromInclusive().datesUntil(baseline.toInclusive().plusDays(1)).count())
                .isEqualTo(ReviewIssueThresholds.surgeBaselineDays());
    }

    @Test
    void theImprovementBaselineAbutsTheImprovementWindowWithoutOverlapping() {
        int windowDays = ReviewIssueThresholds.IMPROVE_WINDOW_WEEKS * 7;
        DateRange window = IssueWindows.trailing(REF, windowDays);
        DateRange baseline = IssueWindows.precedingBlock(REF, windowDays,
                ReviewIssueThresholds.IMPROVE_BASELINE_WEEKS * 7);

        assertThat(baseline.toInclusive()).isEqualTo(window.fromInclusive().minusDays(1));
    }

    /**
     * Rolling seven-day blocks, not calendar weeks. A calendar week would make the persistence
     * verdict depend on which weekday the report ran, so the same data could read 계속 발생 on Monday
     * and not on Sunday.
     */
    @Test
    void trailingWeeksAreRollingBlocksAnchoredOnTheReferenceDate() {
        List<DateRange> weeks = IssueWindows.trailingWeeks(REF, 3);

        assertThat(weeks).hasSize(3);
        assertThat(weeks.get(0)).isEqualTo(
                new DateRange(LocalDate.of(2026, 7, 19), LocalDate.of(2026, 7, 25)));
        assertThat(weeks.get(1)).isEqualTo(
                new DateRange(LocalDate.of(2026, 7, 12), LocalDate.of(2026, 7, 18)));
        assertThat(weeks.get(2)).isEqualTo(
                new DateRange(LocalDate.of(2026, 7, 5), LocalDate.of(2026, 7, 11)));
    }

    @Test
    void weeksDoNotOverlapAndLeaveNoGap() {
        List<DateRange> weeks = IssueWindows.trailingWeeks(REF, 6);
        for (int i = 1; i < weeks.size(); i++) {
            assertThat(weeks.get(i).toInclusive())
                    .isEqualTo(weeks.get(i - 1).fromInclusive().minusDays(1));
        }
    }

    @Test
    void activeWeekCountCountsWeeksNotDates() {
        List<DateRange> weeks = IssueWindows.trailingWeeks(REF, 6);
        // Three dates, but two of them fall in the same week.
        List<LocalDate> dates = List.of(
                LocalDate.of(2026, 7, 25), LocalDate.of(2026, 7, 20), LocalDate.of(2026, 7, 12));

        assertThat(IssueWindows.activeWeekCount(weeks, dates)).isEqualTo(2);
    }

    @Test
    void datesOutsideEveryWeekCountForNothing() {
        List<DateRange> weeks = IssueWindows.trailingWeeks(REF, 2);
        assertThat(IssueWindows.activeWeekCount(weeks, List.of(LocalDate.of(2020, 1, 1))))
                .isZero();
        assertThat(IssueWindows.activeWeekCount(weeks, List.of())).isZero();
    }

    @Test
    void weekBoundariesAreInclusiveOnBothEnds() {
        List<DateRange> weeks = IssueWindows.trailingWeeks(REF, 1);
        assertThat(IssueWindows.activeWeekCount(weeks, List.of(LocalDate.of(2026, 7, 19))))
                .isEqualTo(1);
        assertThat(IssueWindows.activeWeekCount(weeks, List.of(LocalDate.of(2026, 7, 18))))
                .isZero();
    }

    @Test
    void degenerateRangesAreRefusedRatherThanSilentlyEmpty() {
        assertThatThrownBy(() -> IssueWindows.trailing(REF, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> IssueWindows.trailingWeeks(REF, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new DateRange(REF, REF.minusDays(1)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
