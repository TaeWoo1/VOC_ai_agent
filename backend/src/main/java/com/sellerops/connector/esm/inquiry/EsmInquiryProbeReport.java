package com.sellerops.connector.esm.inquiry;

import java.util.Set;

/**
 * Sanitized, content-free summary of one ESM+ INQUIRY read-only probe response.
 * It is the <b>only</b> output a probe is allowed to produce: every field here is
 * a status code, a boolean, a coarse enum/bucket, or the reply-status label set —
 * <b>never</b> a raw body, identifier, buyer/customer value, product name, inquiry
 * text, reply token, exact count, exact timestamp, URL, or credential. The
 * status-label set is the inquiry <i>reply-status vocabulary</i> (schema), not row
 * content.
 *
 * <p>The success body is a top-level JSON array, so {@code bodyIsJsonArray} records
 * whether the body parsed as an array (there is no pagination envelope). Produced by
 * {@link EsmInquiryProbeReporter}; carrying only these fields, the record's generated
 * {@code toString} cannot leak response content. INQUIRY is official-doc confirmed
 * but live-response unverified (not yet checked against a captured live response).
 */
public record EsmInquiryProbeReport(
        int statusCode,
        StatusClass statusClass,
        boolean parseOk,
        boolean bodyIsJsonArray,
        FieldPresence itemFields,
        CountBucket itemCountBucket,
        Set<String> statusTokens,
        ReceiveDateShape receiveDateShape,
        RetryAfterForm retryAfterForm) {

    /** Coarse HTTP outcome class — never the raw status text. */
    public enum StatusClass { SUCCESS, UNAUTHORIZED, RATE_LIMITED, CLIENT_ERROR, SERVER_ERROR, OTHER }

    /** Coarse returned-row count — never an exact count. */
    public enum CountBucket { ZERO, ONE, FEW, TENS, HUNDREDS, THOUSANDS_PLUS }

    /** Shape of the {@code receiveDate} field across rows — never an actual timestamp. */
    public enum ReceiveDateShape { NONE, OFFSET_BEARING, TIMEZONE_LESS, MIXED }

    /** Form of the standard {@code Retry-After} hint on a 429 — never the literal value. */
    public enum RetryAfterForm { NONE, SECONDS, HTTP_DATE }

    /**
     * Which confirmed item fields appeared with a non-blank/non-null value (booleans
     * only — never the values). {@code token} tracks presence of the reply-secret
     * handle without ever copying it. Buyer identity is not modeled, so it has no
     * flag; {@code qnaType} (numeric) and {@code reAsking} (boolean) track non-null.
     */
    public record FieldPresence(boolean messageNo, boolean qnaType, boolean goodsNo,
                                boolean informStatus, boolean receiveDate, boolean title,
                                boolean details, boolean token, boolean reAsking) {
        static FieldPresence absent() {
            return new FieldPresence(false, false, false, false, false, false, false, false, false);
        }
    }
}
