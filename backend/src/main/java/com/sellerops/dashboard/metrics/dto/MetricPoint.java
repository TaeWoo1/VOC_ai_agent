package com.sellerops.dashboard.metrics.dto;

import java.time.LocalDate;

/** One KST calendar day of one series. Days with nothing are present with {@code 0}. */
public record MetricPoint(LocalDate date, long value) {
}
