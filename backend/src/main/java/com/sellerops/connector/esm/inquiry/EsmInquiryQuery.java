package com.sellerops.connector.esm.inquiry;

import java.time.LocalDate;

/**
 * Request parameters for one page of the ESM+ official INQUIRY (판매자 문의) API
 * query, as a value object. The doc-level shape: a bounded date window
 * ({@code from}/{@code to}, see {@link EsmInquiryDateWindow}), an optional inquiry
 * type ({@code qnaType}) and reply-status filter, and a 1-based page index.
 *
 * <p><b>Status: NEEDS_VERIFICATION.</b> Field-to-query-parameter binding is not
 * yet confirmed against the official schema — this record models the request
 * shape for the skeleton only and is <b>not</b> wired into any live fetch path.
 * It carries no credentials and no PII.
 */
public record EsmInquiryQuery(
        LocalDate fromInclusive,
        LocalDate toInclusive,
        String qnaType,
        String statusFilter,
        int page) {

    public EsmInquiryQuery {
        if (fromInclusive == null || toInclusive == null) {
            throw new IllegalArgumentException("query window bounds must not be null");
        }
        if (fromInclusive.isAfter(toInclusive)) {
            throw new IllegalArgumentException("fromInclusive must not be after toInclusive");
        }
        if (page < 1) {
            throw new IllegalArgumentException("page must be >= 1");
        }
    }

    /** Build the first-page query for a window, with no type/status filter. */
    public static EsmInquiryQuery firstPage(EsmInquiryDateWindow window) {
        return new EsmInquiryQuery(window.startInclusive(), window.endInclusive(), null, null, 1);
    }

    /** The same query advanced to the next page. */
    public EsmInquiryQuery nextPage() {
        return new EsmInquiryQuery(fromInclusive, toInclusive, qnaType, statusFilter, page + 1);
    }
}
