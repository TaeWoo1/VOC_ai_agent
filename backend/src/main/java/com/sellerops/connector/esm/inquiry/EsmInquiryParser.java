package com.sellerops.connector.esm.inquiry;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Parses an ESM+ official INQUIRY (판매자 문의) API response body into the
 * source-agnostic {@link CanonicalInquiry} shape used by the rest of the pipeline.
 * This is the read-side parse+map skeleton: it makes no network call, holds no
 * credentials, and is <b>not</b> wired into {@code EsmApiConnector} or any
 * collection path — it exists to prove the response→canonical mapping against
 * <b>synthetic</b> fixtures while INQUIRY remains NEEDS_VERIFICATION.
 *
 * <p><b>Recency compliance:</b> {@link #parseReceivedAt(String)} resolves a
 * timestamp to {@link Instant} <b>only</b> when the source string carries an
 * explicit offset; a timezone-less value stays {@code null} (unknown). It never
 * reads a clock and never assumes KST (no {@code Date.now}/{@code new Date}).
 */
public class EsmInquiryParser {

    private final ObjectMapper mapper = new ObjectMapper();

    /** Parse a raw JSON body into the response envelope. */
    public EsmInquiryResponse parse(String body) {
        try {
            return mapper.readValue(body, EsmInquiryResponse.class);
        } catch (Exception e) {
            // Message only — never echo the body (would be PII in production).
            throw new IllegalArgumentException("ESM 문의 응답을 파싱할 수 없습니다.", e);
        }
    }

    /** Map a parsed response to canonical inquiries (1-based {@code sourceRow}). */
    public List<CanonicalInquiry> toCanonical(EsmInquiryResponse response) {
        List<CanonicalInquiry> out = new ArrayList<>();
        if (response == null || response.items() == null) {
            return out;
        }
        int row = 0;
        for (EsmInquiryResponse.Item item : response.items()) {
            row++;
            out.add(toCanonical(item, row));
        }
        return out;
    }

    /** Map a single response item to a canonical inquiry. */
    public CanonicalInquiry toCanonical(EsmInquiryResponse.Item item, int sourceRow) {
        String product = blankToNull(item.itemName());
        String sku = blankToNull(item.itemNo());
        if (product == null && sku == null) {
            product = "(미지정 상품)";
        }
        String status = EsmInquiryStatus.from(item.status()).toCanonicalStatus();
        Instant receivedAt = parseReceivedAt(item.regDate());
        return new CanonicalInquiry(
                product,
                sku,
                blankToNull(item.buyerId()),
                blankToNull(item.contents()),
                status,
                receivedAt,
                blankToNull(item.inquiryId()),
                sourceRow);
    }

    /**
     * Resolve an offset-bearing timestamp to an {@link Instant}; return {@code
     * null} for a blank or timezone-less value (it stays unknown by design).
     */
    static Instant parseReceivedAt(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(raw.strip()).toInstant();
        } catch (Exception ignored) {
            // Timezone-less / unrecognized => unknown; do not guess an offset.
            return null;
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
