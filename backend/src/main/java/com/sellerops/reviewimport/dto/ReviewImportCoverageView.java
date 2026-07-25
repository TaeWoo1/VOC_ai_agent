package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportCoverage;
import java.time.LocalDate;
import java.util.List;

/** The honest coverage picture: covered / missing / remaining ranges + the baseline date + counts. */
public record ReviewImportCoverageView(
        List<DateRangeView> covered,
        List<DateRangeView> missing,
        List<DateRangeView> remaining,
        LocalDate lastCoveredDate,
        int coveredRows,
        int coveredSegments,
        int remainingSegments,
        int missingSegments) {

    public static ReviewImportCoverageView from(ReviewImportCoverage c) {
        return new ReviewImportCoverageView(
                c.covered().stream().map(DateRangeView::from).toList(),
                c.missing().stream().map(DateRangeView::from).toList(),
                c.remaining().stream().map(DateRangeView::from).toList(),
                c.lastCoveredDate(), c.coveredRows(),
                c.coveredSegments(), c.remainingSegments(), c.missingSegments());
    }
}
