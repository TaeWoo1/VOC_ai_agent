package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import org.junit.jupiter.api.Test;

/**
 * Board-6 (문의사항) article → {@link CanonicalInquiry} mapping. Proves the identity
 * is Cafe24-native only (board+article dedup key, product_no as sku, no external-
 * market origin), that raw {@code reply_status} is preserved verbatim while canonical
 * status is derived conservatively, that buyer PII is never read, and that timestamps
 * follow the offset-only policy.
 */
class Cafe24InquiryArticleMapperTest {

    private static Cafe24BoardArticleRow row(Long articleNo, String title, String content,
                                             Long productNo, String createdDate, String replyStatus) {
        return new Cafe24BoardArticleRow(articleNo, title, content, productNo, null,
                createdDate, null, replyStatus);
    }

    @Test
    void mapsNativeBoard6IdentityAndPreservesRawReplyStatus() {
        Cafe24BoardArticleRow row =
                row(3003L, "곡면 가능?", "곡면에도 붙나요", 88L, "2026-06-20T10:00:00+09:00", "N");

        CanonicalInquiry q = Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row, 1);

        // Dedup key encodes the mall's own board+article pair — no external-market origin.
        assertThat(q.externalId()).isEqualTo("cafe24:b6:a3003");
        assertThat(q.title()).isEqualTo("곡면 가능?");
        assertThat(q.body()).isEqualTo("곡면에도 붙나요");
        assertThat(q.sku()).isEqualTo("88"); // Cafe24 product_no, keyed as sku
        assertThat(q.productName()).isNull(); // sku present → no placeholder name
        assertThat(q.status()).isEqualTo("UNANSWERED"); // N → unanswered
        assertThat(q.informStatus()).isEqualTo("N"); // raw token preserved verbatim
        assertThat(q.receivedAt()).isNotNull(); // offset-bearing → parsed
        assertThat(q.author()).isNull(); // buyer PII never read
        assertThat(q.sourceRow()).isEqualTo(1);
    }

    @Test
    void identityUsesOnlyCafe24NativeFieldsNoExternalMarketOrigin() {
        // A row that carries only the mall's native projection still yields a fully
        // native inquiry — the mapper has no channel from which to read a foreign origin.
        Cafe24BoardArticleRow row = row(4100L, "제목", "본문", 12L, null, "N");

        CanonicalInquiry q = Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row, 3);

        assertThat(q.externalId()).startsWith("cafe24:b6:a").isEqualTo("cafe24:b6:a4100");
        assertThat(Cafe24InquiryArticleMapper.externalId(6, 4100L)).isEqualTo(q.externalId());
    }

    @Test
    void missingProductNoFallsBackToTheIngestPlaceholderName() {
        CanonicalInquiry q =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(5L, "t", "b", null, null, "N"), 1);

        assertThat(q.sku()).isNull();
        assertThat(q.productName()).isEqualTo("(미지정 상품)");
    }

    @Test
    void onlyARecognizedAnsweredTokenBecomesAnswered() {
        // The confirmed unanswered token and any not-yet-observed token stay UNANSWERED;
        // only a recognized answered token flips to ANSWERED (never guessed).
        assertThat(status("N")).isEqualTo("UNANSWERED");
        assertThat(status("answered")).isEqualTo("ANSWERED");
        assertThat(status("COMPLETED")).isEqualTo("ANSWERED");
        assertThat(status("some-unseen-token")).isEqualTo("UNANSWERED");
        assertThat(status(null)).isEqualTo("UNANSWERED");
        assertThat(status("  ")).isEqualTo("UNANSWERED");
    }

    @Test
    void blankReplyStatusLeavesInformStatusNull() {
        CanonicalInquiry q =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(9L, "t", "b", 1L, null, "  "), 1);

        assertThat(q.informStatus()).isNull(); // nothing to preserve
        assertThat(q.status()).isEqualTo("UNANSWERED");
    }

    @Test
    void timezonelessTimestampStaysUnknown() {
        CanonicalInquiry q = Cafe24InquiryArticleMapper.toCanonicalInquiry(
                6, row(9L, "t", "b", 1L, "2026-06-20 10:00:00", "N"), 1);

        // No offset → unknown by design; never an assumed zone.
        assertThat(q.receivedAt()).isNull();
    }

    private static String status(String replyStatus) {
        return Cafe24InquiryArticleMapper
                .toCanonicalInquiry(6, row(1L, "t", "b", 1L, null, replyStatus), 1)
                .status();
    }
}
