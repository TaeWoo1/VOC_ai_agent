package com.sellerops.dashboard.metrics.dto;

import java.util.List;

/**
 * A dense daily series — every day in the period, in order, gaps filled with zero.
 *
 * <p>Dense on purpose: a sparse series drawn as a line silently joins two distant days into a slope
 * that never happened. The zeros here are only ever supplied for channels that were able to report;
 * a channel that could not is absent from the series entirely and named in the response's exclusions.
 */
public record MetricSeries(String key, String label, String unit, List<MetricPoint> points) {
}
