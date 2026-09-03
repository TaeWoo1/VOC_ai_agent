package com.sellerops.inquiry.queue.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * {@code GET /api/inquiries/rows} — the customer's inquiries in a receipt window, in the requested order,
 * cut to {@code limit}. {@code totalCount} is the whole window's count under the same predicate, so a
 * limited page is visible as a page.
 *
 * <p>{@code term} echoes the subject word the read was narrowed by (null when none), for the same
 * reason every other axis is echoed: the caller says what it asked for, so 「현금영수증 관련 문의는 …」
 * can only be said about a read that actually asked for it.
 */
public record InquiryRowsResponse(
        LocalDate from,
        LocalDate to,
        String channel,
        String status,
        String order,
        int limit,
        String term,
        /** The product the read was narrowed to, echoed like every other axis. Null = every product. */
        java.util.UUID productId,
        long totalCount,
        List<InquiryRowItem> items) {

    /** The pre-term shape, kept so existing callers and tests read unchanged. */
    public InquiryRowsResponse(LocalDate from, LocalDate to, String channel, String status, String order,
                               int limit, long totalCount, List<InquiryRowItem> items) {
        this(from, to, channel, status, order, limit, null, null, totalCount, items);
    }

    /** The pre-product shape. */
    public InquiryRowsResponse(LocalDate from, LocalDate to, String channel, String status, String order,
                               int limit, String term, long totalCount, List<InquiryRowItem> items) {
        this(from, to, channel, status, order, limit, term, null, totalCount, items);
    }
}
