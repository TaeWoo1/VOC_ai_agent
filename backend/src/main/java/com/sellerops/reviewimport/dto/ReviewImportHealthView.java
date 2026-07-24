package com.sellerops.reviewimport.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * The minimum import-health surface for a seller account: how far coverage reaches, what is still missing,
 * how many reviews came in vs were already present vs failed, and the next import to recommend.
 *
 * <p>{@code nextRecommendedImport} is the earliest still-uncovered start when work remains (finish this
 * import first), otherwise the day after {@code lastCoveredDate} (go incremental from the baseline), or
 * null when nothing has been covered yet.
 */
public record ReviewImportHealthView(
        LocalDate lastCoveredDate,
        List<DateRangeView> missingRanges,
        int newCount,
        int duplicateCount,
        int failedCount,
        LocalDate nextRecommendedImport) {
}
