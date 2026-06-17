package com.sellerops.ingest.canonical;

import java.time.LocalDate;

/** Source-agnostic per-day order/sales summary for one channel.
 *  {@code sourceRow} is the 1-based originating file row (for error reporting). */
public record CanonicalOrderSummary(
        LocalDate summaryDate,
        int orderCount,
        long salesAmount,
        int sourceRow) {
}
