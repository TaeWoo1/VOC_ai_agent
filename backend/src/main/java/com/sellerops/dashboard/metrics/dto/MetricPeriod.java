package com.sellerops.dashboard.metrics.dto;

import java.time.LocalDate;

/**
 * The window a metric answers for, and the window it is compared against.
 *
 * <p>Both are stated because a delta with an unnamed baseline is not a measurement. The comparison
 * window is the immediately preceding span of the same length, so "최근 7일 vs 이전 7일" is exactly
 * what the field names say and not a rolling average dressed up as one.
 */
public record MetricPeriod(LocalDate from, LocalDate to, LocalDate previousFrom, LocalDate previousTo,
                           int days) {
}
