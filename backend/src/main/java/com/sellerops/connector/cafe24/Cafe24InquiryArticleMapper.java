package com.sellerops.connector.cafe24;

import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.Instant;

/**
 * Maps a Cafe24 board-6 (문의사항) article row to a source-agnostic
 * {@link CanonicalInquiry}, so a product inquiry flows into the common inquiry +
 * OPEN work-queue path (the seller-confirmed reply lifecycle) rather than the
 * community/VOC store. Board-4 reviews keep using {@link Cafe24BoardArticleMapper};
 * board 9 (1:1 맞춤상담) is never collected.
 *
 * <p><b>Identity is Cafe24-native only.</b> The dedup {@code externalId} encodes the
 * mall's own {@code (board, article)} pair and the product ref is the mall's {@code
 * product_no}. No external-marketplace / Market Plus origin is read, inferred, or
 * stored — none is present in the row projection ({@link Cafe24BoardArticleRow}
 * ignores every other field). Buyer/writer PII is never read (not projected) and
 * never persisted.
 *
 * <p>Raw {@code reply_status} is preserved verbatim as {@code informStatus};
 * canonical {@code status} is derived through the confirmed {@link
 * CommunityReplyStatus} vocabulary (the single source of truth for the tokens): only
 * a recognized <em>answered</em> token yields {@code ANSWERED}, while the confirmed
 * unanswered {@code N} and any token not yet observed live both stay {@code
 * UNANSWERED}, so the inquiry conservatively enters the OPEN queue. Timestamps parse
 * only when offset-bearing; a timezone-less value stays unknown.
 */
final class Cafe24InquiryArticleMapper {

    private Cafe24InquiryArticleMapper() {
    }

    /**
     * Build a canonical inquiry. The caller guarantees {@code row.articleNo()} is
     * non-null (a row without it cannot be keyed and is dropped upstream).
     * {@code sourceRow} is the 1-based position in the fetched page.
     */
    static CanonicalInquiry toCanonicalInquiry(int boardNo, Cafe24BoardArticleRow row, int sourceRow) {
        String sku = row.productNo() == null ? null : Long.toString(row.productNo());
        // No product name is available on a board article; keep the ingest placeholder
        // only when there is also no sku to key the product by.
        String productName = sku == null ? "(미지정 상품)" : null;
        String informStatus = blankToNull(row.replyStatus());
        return new CanonicalInquiry(
                productName,
                sku,
                // Buyer PII is never read (not projected) and never persisted.
                null,
                row.content(),
                toCanonicalStatus(informStatus),
                Cafe24BoardArticleMapper.parseOffsetInstant(row.createdDate()),
                externalId(boardNo, row.articleNo()),
                sourceRow,
                row.title(),
                informStatus);
    }

    /** Stable Cafe24-native dedup key preserving the mall's own board+article identity. */
    static String externalId(int boardNo, long articleNo) {
        return "cafe24:b" + boardNo + ":a" + articleNo;
    }

    /**
     * Collapse the raw reply token to the canonical binary status through the confirmed
     * {@link CommunityReplyStatus} vocabulary. Only a recognized answered token maps to
     * {@code ANSWERED}; the confirmed unanswered {@code N}, and any token not yet
     * observed live, both stay {@code UNANSWERED}.
     */
    private static String toCanonicalStatus(String rawReplyStatus) {
        return CommunityReplyStatus.normalize(rawReplyStatus) == CommunityReplyStatus.ANSWERED
                ? "ANSWERED"
                : "UNANSWERED";
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
