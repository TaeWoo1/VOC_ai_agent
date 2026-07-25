package com.sellerops.reviewimport;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.reviewimport.ReviewImportSegmentPlanner.DateRange;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Coverage rollup: the three coverage states partition the live segments, adjacent same-state segments
 * merge into one range, superseded (split-parent) segments are ignored, and lastCoveredDate is the
 * baseline for a later incremental import.
 */
class ReviewImportCoverageTest {

    private static ReviewImportSegment seg(String start, String end, SegmentCoverageState cov, Integer rows, boolean superseded) {
        ReviewImportSegment s = new ReviewImportSegment();
        s.setSegmentStart(LocalDate.parse(start));
        s.setSegmentEnd(LocalDate.parse(end));
        s.setCoverageState(cov);
        s.setCoveredRows(rows);
        s.setSuperseded(superseded);
        return s;
    }

    private static DateRange r(String s, String e) {
        return new DateRange(LocalDate.parse(s), LocalDate.parse(e));
    }

    @Test
    void adjacentCoveredMonthsMergeAndReportLastCoveredDate() {
        ReviewImportCoverage c = ReviewImportCoverage.of(List.of(
                seg("2026-01-01", "2026-01-31", SegmentCoverageState.COVERED, 10, false),
                seg("2026-02-01", "2026-02-28", SegmentCoverageState.COVERED, 4, false),
                seg("2026-04-01", "2026-04-30", SegmentCoverageState.COVERED, 0, false)));
        assertThat(c.covered()).containsExactly(r("2026-01-01", "2026-02-28"), r("2026-04-01", "2026-04-30"));
        assertThat(c.lastCoveredDate()).isEqualTo(LocalDate.parse("2026-04-30"));
        assertThat(c.coveredRows()).isEqualTo(14);
        assertThat(c.coveredSegments()).isEqualTo(3);
    }

    @Test
    void statesPartitionIntoCoveredMissingRemaining() {
        ReviewImportCoverage c = ReviewImportCoverage.of(List.of(
                seg("2025-11-01", "2025-11-30", SegmentCoverageState.MISSING, null, false),
                seg("2025-12-01", "2025-12-31", SegmentCoverageState.UNVERIFIED, null, false),
                seg("2026-01-01", "2026-01-31", SegmentCoverageState.COVERED, 7, false)));
        assertThat(c.missing()).containsExactly(r("2025-11-01", "2025-11-30"));
        assertThat(c.remaining()).containsExactly(r("2025-12-01", "2025-12-31"));
        assertThat(c.covered()).containsExactly(r("2026-01-01", "2026-01-31"));
        assertThat(c.missingSegments()).isEqualTo(1);
        assertThat(c.remainingSegments()).isEqualTo(1);
    }

    @Test
    void supersededSegmentsAreIgnored() {
        ReviewImportCoverage c = ReviewImportCoverage.of(List.of(
                seg("2026-03-01", "2026-03-31", SegmentCoverageState.UNVERIFIED, null, true),   // split parent
                seg("2026-03-01", "2026-03-15", SegmentCoverageState.COVERED, 3, false),
                seg("2026-03-16", "2026-03-31", SegmentCoverageState.COVERED, 2, false)));
        assertThat(c.covered()).containsExactly(r("2026-03-01", "2026-03-31"));
        assertThat(c.remaining()).isEmpty();
        assertThat(c.coveredRows()).isEqualTo(5);
    }

    @Test
    void emptyPlanHasNoCoverageAndNullBaseline() {
        ReviewImportCoverage c = ReviewImportCoverage.of(List.of());
        assertThat(c.covered()).isEmpty();
        assertThat(c.lastCoveredDate()).isNull();
        assertThat(c.coveredRows()).isZero();
    }
}
