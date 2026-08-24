package com.sellerops.dashboard.dto;

import com.sellerops.dashboard.insights.dto.OperationsInsight;
import com.sellerops.dashboard.metrics.dto.OperationsMetricsResponse;
import java.util.List;

/**
 * The whole first screen in one read.
 *
 * <p>One round trip on purpose: the insights are DERIVED from the metrics (the backlog card counts
 * the same channels the KPI counted), and letting the screen fetch the two separately would let them
 * be computed over different moments and disagree in front of the seller.
 */
public record OverviewResponse(OperationsMetricsResponse metrics, List<OperationsInsight> insights) {
}
