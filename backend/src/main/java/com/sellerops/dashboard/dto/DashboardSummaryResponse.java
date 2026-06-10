package com.sellerops.dashboard.dto;

import com.sellerops.inbox.dto.FeedItem;
import com.sellerops.order.dto.ChannelSalesShare;
import com.sellerops.order.dto.SalesTrendPoint;
import java.util.List;

public record DashboardSummaryResponse(
        DashboardCards cards,
        List<String> todoItems,
        List<TopProductIssue> topProductIssues,
        List<FeedItem> recentFeed,
        List<SalesTrendPoint> salesTrend,
        List<ChannelSalesShare> channelSalesShare) {
}
