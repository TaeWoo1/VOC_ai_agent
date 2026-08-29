package com.sellerops.inquiry.queue.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * {@code GET /api/inquiries/rows} — the customer's inquiries in a receipt window, in the requested order,
 * cut to {@code limit}. {@code totalCount} is the whole window's count under the same predicate, so a
 * limited page is visible as a page.
 */
public record InquiryRowsResponse(
        LocalDate from,
        LocalDate to,
        String channel,
        String status,
        String order,
        int limit,
        long totalCount,
        List<InquiryRowItem> items) {
}
