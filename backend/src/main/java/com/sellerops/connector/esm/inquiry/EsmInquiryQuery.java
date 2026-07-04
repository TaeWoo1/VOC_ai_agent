package com.sellerops.connector.esm.inquiry;

import java.time.LocalDate;

/**
 * Request parameters for one ESM+ official INQUIRY (판매자 문의) API call, as a
 * value object: a bounded date window ({@code from}/{@code to}, see {@link
 * EsmInquiryDateWindow}) plus the official <b>numeric</b> filters — {@code qnaType}
 * (inquiry type), {@code status} (reply-status), and {@code type} (query type). Any
 * filter may be {@code null} (unfiltered).
 *
 * <p>There is <b>no</b> {@code page}/{@code pageSize}: the success response is a
 * top-level array with no pagination envelope, so a call returns the window's rows
 * in one shot and no page walking is modeled.
 *
 * <p><b>Verification: official-doc confirmed, live-response unverified.</b> The
 * field-to-parameter binding follows the official schema but the exact numeric code
 * sets are not yet checked against a captured live response — this record models the
 * request shape for the skeleton only and is <b>not</b> wired into any live fetch
 * path. It carries no credentials and no PII.
 */
public record EsmInquiryQuery(
        LocalDate fromInclusive,
        LocalDate toInclusive,
        Integer qnaType,
        Integer status,
        Integer type) {

    public EsmInquiryQuery {
        if (fromInclusive == null || toInclusive == null) {
            throw new IllegalArgumentException("query window bounds must not be null");
        }
        if (fromInclusive.isAfter(toInclusive)) {
            throw new IllegalArgumentException("fromInclusive must not be after toInclusive");
        }
    }
}
