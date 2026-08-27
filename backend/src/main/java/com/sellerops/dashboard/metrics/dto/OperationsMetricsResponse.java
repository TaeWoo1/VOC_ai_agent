package com.sellerops.dashboard.metrics.dto;

import java.util.List;

/**
 * Everything the Overview dashboard draws, assembled once so the screen never has to decide.
 *
 * <p><b>{@code revenueBasis} travels with the number.</b> The three connected channels do not compute
 * "매출" the same way — NAVER sums post-discount payment on PAYED 상품주문 rows, Coupang sums
 * {@code orderPrice} per shipment box, Cafe24 sums {@code payment_amount} per distinct order — and
 * none of them nets cancellations. The sum of the three is a real quantity with a specific
 * definition, and shipping the definition beside it is the difference between a figure and a claim
 * ({@code docs/demo_core_experience_v1.md} §4.1).
 *
 * <p><b>{@code exampleDataIncluded} is a disclosure, not a setting.</b> It is true only on the one
 * path where these figures were computed over rows the product manufactured about itself — an
 * otherwise-empty window on a deployment that seeded demo content. The screen has to render it; a
 * seller looking at ￦3,012,162 is entitled to know whether their shop earned it.
 */
public record OperationsMetricsResponse(MetricPeriod period,
                                        String revenueBasis,
                                        String orderCountBasis,
                                        List<MetricKpi> kpis,
                                        List<MetricSeries> series,
                                        List<ChannelMetricRow> channels,
                                        List<MetricExclusion> exclusions,
                                        boolean exampleDataIncluded) {
}
