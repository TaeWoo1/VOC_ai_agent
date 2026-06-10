package com.sellerops.order.dto;

import java.util.List;

public record OrderSummaryResponse(
        long totalOrders7d,
        long totalSales7d,
        List<SalesTrendPoint> trend,
        List<ChannelSalesShare> channelShare) {
}
