package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportSegment;
import java.time.LocalDate;
import java.util.UUID;

/**
 * One segment for the operator: its window, both state axes (execution + coverage) surfaced separately,
 * the covered-row count, and the honest {@code rowsReconciled} flag. Split-parent segments carry
 * {@code superseded = true}.
 */
public record ReviewImportSegmentView(
        UUID id,
        int ordinal,
        LocalDate segmentStart,
        LocalDate segmentEnd,
        String executionState,
        String coverageState,
        Integer coveredRows,
        boolean rowsReconciled,
        boolean superseded,
        UUID parentSegmentId) {

    public static ReviewImportSegmentView from(ReviewImportSegment s) {
        return new ReviewImportSegmentView(s.getId(), s.getOrdinal(), s.getSegmentStart(), s.getSegmentEnd(),
                s.getExecutionState().name(), s.getCoverageState().name(), s.getCoveredRows(),
                s.isRowsReconciled(), s.isSuperseded(), s.getParentSegmentId());
    }
}
