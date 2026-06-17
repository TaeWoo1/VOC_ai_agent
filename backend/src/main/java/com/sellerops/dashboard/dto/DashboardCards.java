package com.sellerops.dashboard.dto;

/** The 8 home-dashboard summary cards. */
public record DashboardCards(
        int todayOrders,
        long todaySales,
        long newInquiries,
        long unansweredInquiries,
        long newReviews,
        long negativeReviews,
        long urgentCount,
        long unhandledCount) {
}
