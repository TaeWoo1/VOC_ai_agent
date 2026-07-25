package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportLaunchService.RangeSelection;
import java.time.LocalDate;

/**
 * What a chosen start month would create, for the confirmation the seller sees BEFORE a plan exists.
 *
 * <p>{@code segmentCount} is the point of this view. The period alone reads as one decision; the count says what
 * it actually costs — one guided export per calendar month, performed by hand — so three years is 37 of them.
 * Showing the period without the count is how a seller agrees to work they did not know they were agreeing to.
 */
public record ReviewImportRangeSelectionView(LocalDate start, LocalDate end, int segmentCount) {

    public static ReviewImportRangeSelectionView from(RangeSelection selection) {
        return new ReviewImportRangeSelectionView(selection.start(), selection.end(), selection.segmentCount());
    }
}
