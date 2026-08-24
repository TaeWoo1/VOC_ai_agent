package com.sellerops.connector.cafe24;

import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.ChannelProductRef;

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
 * <p><b>The product is decided by {@code product_no} and by nothing else.</b> Until
 * 2026-08-24 this mapper passed {@code product_no} as a canonical {@code sku} and let
 * ingest resolve-or-create on it, which is a different rule wearing the same clothes:
 * Cafe24's {@code product_no} is a <em>listing</em> key, while {@code products.sku} is
 * the seller's own code ({@code custom_product_code} — {@code Cafe24ProductMapper}
 * prefers it), so the two matched only for listings whose seller set no code. When they
 * did not match, ingest invented a product named after the number. Three such rows exist
 * in the canonical Demo Org ({@code 91}, {@code 94}, {@code 170}) and all three numbers
 * are present in {@code channel_products} as real, linked listings — the attribution was
 * available and was replaced by a fabrication.
 *
 * <p>Declaring a {@link ChannelProductRef} makes that impossible: ingest matches
 * {@code (channel_id, external_product_id)} exactly or attributes nothing. An article
 * with no {@code product_no} — which on board 6 is nearly all of them — yields
 * {@link ChannelProductRef#absent()}, and unattributed is the true answer for it.
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
        // Cafe24 uses 0 as "no product" on some board rows; only a positive number is an identity.
        String productNo = row.productNo() == null || row.productNo() <= 0
                ? null : Long.toString(row.productNo());
        String informStatus = blankToNull(row.replyStatus());
        // Fail-closed secrecy: only a positively-public flag ("F"/"false") reads public;
        // "T", null, blank, or any unrecognized value is treated as secret.
        boolean isSecret = !row.isPublicPost();
        return new CanonicalInquiry(
                // Name and SKU are no longer how this source finds its product; leaving them null
                // keeps the resolve-or-create path unreachable from here.
                null,
                null,
                // Buyer PII is never read (not projected) and never persisted.
                null,
                row.content(),
                toCanonicalStatus(informStatus),
                Cafe24BoardArticleMapper.parseOffsetInstant(row.createdDate()),
                externalId(boardNo, row.articleNo()),
                sourceRow,
                row.title(),
                informStatus,
                isSecret,
                // Board 6 is the mall's only inquiry surface SellerOps collects.
                null,
                ChannelProductRef.of(productNo),
                // A board article carries no seller answer body; only the reply_status flag.
                null,
                null);
    }

    /** Stable Cafe24-native dedup key preserving the mall's own board+article identity. */
    static String externalId(int boardNo, long articleNo) {
        return "cafe24:b" + boardNo + ":a" + articleNo;
    }

    /**
     * Collapse the raw reply token to the canonical binary status through the confirmed
     * {@link CommunityReplyStatus} vocabulary (Cafe24: {@code N}=답변전, {@code P}=처리중,
     * {@code C}=처리완료). {@code C} → {@code ANSWERED}; {@code N} and {@code P} (in
     * progress — still needs action) → {@code UNANSWERED}; blank/unrecognized stays
     * {@code UNANSWERED} (never guessed as answered).
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
