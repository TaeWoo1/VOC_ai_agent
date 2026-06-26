package com.sellerops.collect.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Operator dashboard summary for one connected channel account over an explicit
 * date window. Channel-generic shape: order/sales totals come from the shared
 * daily-summary store, the review/inquiry counts from collected community
 * articles, and the sync state from the connection-health row.
 *
 * <p>The window is always supplied by the caller (no server clock), and dates are
 * interpreted in the channel's policy zone (KST for Cafe24). {@code unansweredInquiries}
 * is conservative: it counts only inquiries whose reply status is the confirmed
 * {@code PENDING} token, never rows whose answered/other token is still unverified.
 * Counts cover only articles with a known source date; unknown-date rows are
 * excluded from the windowed counts rather than assumed into the range.
 */
public record AccountDashboardSummary(
        UUID sellerAccountId,
        UUID channelId,
        String channelNameKo,
        LocalDate fromDate,
        LocalDate toDate,
        long salesAmount,
        long orderCount,
        long newReviews,
        long newInquiries,
        long unansweredInquiries,
        String lastSyncState,
        Instant lastSuccessAt) {
}
