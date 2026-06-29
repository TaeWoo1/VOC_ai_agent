package com.sellerops.connector.esm.inquiry;

import java.util.Set;

/**
 * Sanitized, content-free summary of one ESM+ INQUIRY read-only probe response.
 * It is the <b>only</b> output a probe is allowed to produce: every field here is
 * a status code, a boolean, a coarse enum/bucket, or the reply-status label set —
 * <b>never</b> a raw body, identifier, buyer/customer value, product name, inquiry
 * text, exact count, exact timestamp, URL, or credential. The status-label set is
 * the inquiry <i>reply-status vocabulary</i> (schema), not row content.
 *
 * <p>Produced by {@link EsmInquiryProbeReporter}; consult that class for how each
 * signal is derived. Carrying only these fields, the record's generated
 * {@code toString} cannot leak response content. INQUIRY remains NEEDS_VERIFICATION.
 */
public record EsmInquiryProbeReport(
        int statusCode,
        StatusClass statusClass,
        boolean parseOk,
        boolean bodyIsValidJson,
        EnvelopePresence envelope,
        FieldPresence itemFields,
        CountBucket itemCountBucket,
        Set<String> statusTokens,
        RegDateShape regDateShape,
        RetryAfterForm retryAfterForm) {

    /** Coarse HTTP outcome class — never the raw status text. */
    public enum StatusClass { SUCCESS, UNAUTHORIZED, RATE_LIMITED, CLIENT_ERROR, SERVER_ERROR, OTHER }

    /** Coarse returned-row count — never an exact count. */
    public enum CountBucket { ZERO, ONE, FEW, TENS, HUNDREDS, THOUSANDS_PLUS }

    /** Shape of the {@code regDate} field across rows — never an actual timestamp. */
    public enum RegDateShape { NONE, OFFSET_BEARING, TIMEZONE_LESS, MIXED }

    /** Form of the standard {@code Retry-After} hint on a 429 — never the literal value. */
    public enum RetryAfterForm { NONE, SECONDS, HTTP_DATE }

    /** Which envelope keys were present (booleans only). */
    public record EnvelopePresence(boolean itemsPresent, boolean totalCountPresent,
                                   boolean pagePresent, boolean pageSizePresent) {
        static EnvelopePresence absent() {
            return new EnvelopePresence(false, false, false, false);
        }
    }

    /** Which item fields appeared with a non-blank value (booleans only — never the values). */
    public record FieldPresence(boolean inquiryId, boolean qnaType, boolean itemName, boolean itemNo,
                                boolean buyerId, boolean contents, boolean status, boolean regDate) {
        static FieldPresence absent() {
            return new FieldPresence(false, false, false, false, false, false, false, false);
        }
    }
}
