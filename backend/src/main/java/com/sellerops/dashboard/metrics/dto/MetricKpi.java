package com.sellerops.dashboard.metrics.dto;

/**
 * One headline number, with everything a reader needs to know whether to trust it.
 *
 * <p><b>{@code comparable} is not decoration.</b> 미답변 문의 is a CURRENT state, not a flow: comparing
 * "지금 미답변인 건수" against "지난주 이맘때 미답변이던 건수" would need a history this table does not
 * keep, and a delta invented from the rows that happen to survive today would read as a trend. A
 * non-comparable KPI carries no previous value and no delta, and the screen must not draw one.
 *
 * <p><b>{@code excludedChannels} counts what is NOT in {@code value}.</b> A total assembled from the
 * channels that could actually report is honest only while it says which ones could not — otherwise a
 * disconnected channel silently becomes a zero, the exact conflation
 * {@code ChannelDataState} exists to prevent.
 */
public record MetricKpi(String key, String label, long value, String unit,
                        Long previousValue, Integer deltaPercent, boolean comparable,
                        int excludedChannels, boolean freshnessUnproven) {
}
