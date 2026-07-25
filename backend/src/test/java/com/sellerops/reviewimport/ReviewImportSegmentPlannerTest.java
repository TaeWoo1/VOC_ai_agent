package com.sellerops.reviewimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import com.sellerops.reviewimport.ReviewImportSegmentPlanner.DateRange;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Calendar-month segmentation is the V1 plan shape, so its edges are pinned: partial first/last months are
 * clipped to the request, whole months fill in between, adjacent segments never overlap by a day, and a
 * missing/inverted range fails closed rather than planning an unbounded sweep. No NAVER row cap appears
 * here — the segment count is a function of the calendar span alone.
 */
class ReviewImportSegmentPlannerTest {

    private static DateRange r(String start, String end) {
        return new DateRange(LocalDate.parse(start), LocalDate.parse(end));
    }

    @Test
    void wholeMonthsInAYearProduceOneSegmentPerMonth() {
        List<DateRange> out = ReviewImportSegmentPlanner.monthlySegments(
                LocalDate.parse("2026-01-01"), LocalDate.parse("2026-12-31"));
        assertThat(out).hasSize(12);
        assertThat(out.get(0)).isEqualTo(r("2026-01-01", "2026-01-31"));
        assertThat(out.get(1)).isEqualTo(r("2026-02-01", "2026-02-28")); // 2026 is not a leap year
        assertThat(out.get(11)).isEqualTo(r("2026-12-01", "2026-12-31"));
    }

    @Test
    void partialFirstAndLastMonthsAreClippedToTheRequest() {
        List<DateRange> out = ReviewImportSegmentPlanner.monthlySegments(
                LocalDate.parse("2026-01-15"), LocalDate.parse("2026-03-10"));
        assertThat(out).containsExactly(
                r("2026-01-15", "2026-01-31"),
                r("2026-02-01", "2026-02-28"),
                r("2026-03-01", "2026-03-10"));
    }

    @Test
    void adjacentSegmentsNeverOverlapAndTileTheWholeRange() {
        List<DateRange> out = ReviewImportSegmentPlanner.monthlySegments(
                LocalDate.parse("2025-11-20"), LocalDate.parse("2026-02-05"));
        assertThat(out).containsExactly(
                r("2025-11-20", "2025-11-30"),
                r("2025-12-01", "2025-12-31"),
                r("2026-01-01", "2026-01-31"),
                r("2026-02-01", "2026-02-05"));
        for (int i = 1; i < out.size(); i++) {
            assertThat(out.get(i).start()).isEqualTo(out.get(i - 1).end().plusDays(1));
        }
    }

    @Test
    void leapFebruaryEndsOnThe29th() {
        List<DateRange> out = ReviewImportSegmentPlanner.monthlySegments(
                LocalDate.parse("2028-02-01"), LocalDate.parse("2028-02-29"));
        assertThat(out).containsExactly(r("2028-02-01", "2028-02-29"));
    }

    @Test
    void singleDayRequestYieldsOneOneDaySegment() {
        List<DateRange> out = ReviewImportSegmentPlanner.monthlySegments(
                LocalDate.parse("2026-06-07"), LocalDate.parse("2026-06-07"));
        assertThat(out).containsExactly(r("2026-06-07", "2026-06-07"));
    }

    @Test
    void invertedRangeFailsClosed() {
        assertThatThrownBy(() -> ReviewImportSegmentPlanner.monthlySegments(
                LocalDate.parse("2026-06-07"), LocalDate.parse("2026-06-01")))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void missingBoundFailsClosed() {
        assertThatThrownBy(() -> ReviewImportSegmentPlanner.monthlySegments(null, LocalDate.parse("2026-06-01")))
                .isInstanceOf(ApiException.class);
    }
}
