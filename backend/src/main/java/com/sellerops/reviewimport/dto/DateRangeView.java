package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportSegmentPlanner.DateRange;
import java.time.LocalDate;

/** An inclusive [start, end] date window, for coverage/missing/remaining ranges in responses. */
public record DateRangeView(LocalDate start, LocalDate end) {
    public static DateRangeView from(DateRange r) {
        return new DateRangeView(r.start(), r.end());
    }
}
