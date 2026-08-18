package com.sellerops.inbox.dto;

import java.util.List;

/**
 * The inbox feed.
 *
 * @param items newest-first rows, capped by the request's {@code limit}
 * @param total number of rows returned (the cap applied)
 * @param unansweredInquiries the org's UNANSWERED inquiries, counted server-side and never capped —
 *     the canonical "답변이 필요한 문의" number the home and the 문의 screen both show
 *     (product assembly A4, 2026-08-18)
 */
public record InboxResponse(List<FeedItem> items, long total, long unansweredInquiries) {
}
