package com.sellerops.reviewimport;

import com.sellerops.reviewimport.ReviewImportSegmentPlanner.DateRange;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * The honest coverage picture of a plan, computed purely from its live (non-superseded) segments. The
 * three coverage states partition the segments, so covered / missing / remaining ranges never overlap and
 * together account for every live segment. Adjacent same-state segments merge into one range so a seller
 * reads "2026-01 … 2026-06 covered" rather than six rows.
 *
 * <p>{@code remaining} is coverage {@link SegmentCoverageState#UNVERIFIED} — work still to do, whatever its
 * execution state (PENDING, mid-ACTIVE, or a retryable FAILED). {@code lastCoveredDate} is the latest end
 * of any COVERED range: the baseline a later incremental import continues from.
 */
public record ReviewImportCoverage(
        List<DateRange> covered,
        List<DateRange> missing,
        List<DateRange> remaining,
        LocalDate lastCoveredDate,
        int coveredRows,
        int coveredSegments,
        int remainingSegments,
        int missingSegments) {

    public static ReviewImportCoverage of(List<ReviewImportSegment> liveSegments) {
        List<ReviewImportSegment> covered = byCoverage(liveSegments, SegmentCoverageState.COVERED);
        List<ReviewImportSegment> missing = byCoverage(liveSegments, SegmentCoverageState.MISSING);
        List<ReviewImportSegment> remaining = byCoverage(liveSegments, SegmentCoverageState.UNVERIFIED);

        LocalDate lastCovered = covered.stream()
                .map(ReviewImportSegment::getSegmentEnd)
                .max(Comparator.naturalOrder())
                .orElse(null);
        int coveredRows = covered.stream()
                .mapToInt(s -> s.getCoveredRows() == null ? 0 : s.getCoveredRows())
                .sum();

        return new ReviewImportCoverage(
                mergeRanges(covered), mergeRanges(missing), mergeRanges(remaining),
                lastCovered, coveredRows, covered.size(), remaining.size(), missing.size());
    }

    private static List<ReviewImportSegment> byCoverage(List<ReviewImportSegment> segs, SegmentCoverageState state) {
        return segs.stream().filter(s -> !s.isSuperseded() && s.getCoverageState() == state).toList();
    }

    /** Merge segments (any order) into minimal inclusive ranges, joining contiguous (end+1 == next start) or overlapping ones. */
    private static List<DateRange> mergeRanges(List<ReviewImportSegment> segs) {
        List<ReviewImportSegment> sorted = new ArrayList<>(segs);
        sorted.sort(Comparator.comparing(ReviewImportSegment::getSegmentStart));
        List<DateRange> out = new ArrayList<>();
        LocalDate curStart = null;
        LocalDate curEnd = null;
        for (ReviewImportSegment s : sorted) {
            if (curStart == null) {
                curStart = s.getSegmentStart();
                curEnd = s.getSegmentEnd();
            } else if (!s.getSegmentStart().isAfter(curEnd.plusDays(1))) {
                if (s.getSegmentEnd().isAfter(curEnd)) {
                    curEnd = s.getSegmentEnd();
                }
            } else {
                out.add(new DateRange(curStart, curEnd));
                curStart = s.getSegmentStart();
                curEnd = s.getSegmentEnd();
            }
        }
        if (curStart != null) {
            out.add(new DateRange(curStart, curEnd));
        }
        return out;
    }
}
