package com.sellerops.connector.esm.inquiry;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Parses the ESM+ official INQUIRY (판매자 문의) API response into the
 * source-agnostic {@link CanonicalInquiry} shape. The <b>success</b> body is a
 * top-level JSON array of {@link EsmInquiryItem} (no pagination envelope); a
 * <b>failure</b> body is the {@link EsmInquiryError} object. This is the read-side
 * parse+map skeleton: it makes no network call, holds no credentials, and is
 * <b>not</b> wired into {@code EsmApiConnector} or any collection path (live ESM
 * inquiry ingestion is not enabled) — it exists to prove the response→canonical
 * mapping against <b>synthetic</b> fixtures. The mapping is official-doc confirmed
 * but live-response unverified (not yet checked against a captured live response).
 *
 * <p><b>Recency compliance:</b> {@link #parseReceivedAt(String)} resolves a
 * timestamp to {@link Instant} <b>only</b> when the source string carries an
 * explicit offset; a timezone-less value stays {@code null} (unknown). It never
 * reads a clock and never assumes KST (no {@code Date.now}/{@code new Date}).
 */
public class EsmInquiryParser {

    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * Parse a success body (a top-level JSON array) into inquiry rows. Never echoes
     * the body on failure (it would be PII in production).
     */
    public List<EsmInquiryItem> parseItems(String body) {
        try {
            EsmInquiryItem[] items = mapper.readValue(body, EsmInquiryItem[].class);
            if (items == null) {
                return List.of();
            }
            List<EsmInquiryItem> out = new ArrayList<>(items.length);
            for (EsmInquiryItem item : items) {
                if (item != null) {
                    out.add(item);
                }
            }
            return out;
        } catch (Exception e) {
            // Message only — never echo the body (would be PII in production).
            throw new IllegalArgumentException("ESM 문의 응답을 파싱할 수 없습니다.", e);
        }
    }

    /**
     * Best-effort parse of a failure body ({@code { resultCode, message }}). Returns
     * {@code null} when the body is not that shape (no numeric {@code resultCode}),
     * so a caller can fall back to status-only handling. Never throws.
     */
    public EsmInquiryError parseError(String body) {
        try {
            EsmInquiryError error = mapper.readValue(body, EsmInquiryError.class);
            return error != null && error.resultCode() != null ? error : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    /** Map parsed rows to canonical inquiries (1-based {@code sourceRow}). */
    public List<CanonicalInquiry> toCanonical(List<EsmInquiryItem> items) {
        List<CanonicalInquiry> out = new ArrayList<>();
        if (items == null) {
            return out;
        }
        int row = 0;
        for (EsmInquiryItem item : items) {
            row++;
            out.add(toCanonical(item, row));
        }
        return out;
    }

    /**
     * Map a single row to a canonical inquiry. Buyer identity is never read (not in
     * the model); the reply {@code token}, {@code qnaType}, and {@code reAsking} are
     * intentionally not mapped (the token is discarded after parsing). The product
     * ref comes from {@code goodsNo} (site-specific {@code siteGoodsNo} as fallback)
     * — the model carries no product name.
     */
    public CanonicalInquiry toCanonical(EsmInquiryItem item, int sourceRow) {
        String sku = blankToNull(item.goodsNo());
        if (sku == null) {
            sku = blankToNull(item.siteGoodsNo());
        }
        String product = sku == null ? "(미지정 상품)" : null;
        String informStatus = blankToNull(item.informStatus());
        String status = EsmInquiryStatus.from(informStatus).toCanonicalStatus();
        Instant receivedAt = parseReceivedAt(item.receiveDate());
        return new CanonicalInquiry(
                product,
                sku,
                // Buyer PII is not persisted; the connector path never sets author.
                null,
                blankToNull(item.details()),
                status,
                receivedAt,
                blankToNull(item.messageNo()),
                sourceRow,
                blankToNull(item.title()),
                informStatus);
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
