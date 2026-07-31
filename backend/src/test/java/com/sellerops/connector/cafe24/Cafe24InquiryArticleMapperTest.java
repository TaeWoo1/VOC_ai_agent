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
    void mapsCafe24ReplyStatusTokensNpcToCanonicalStatus() {
        // Official Cafe24 tokens: N=답변전, P=처리중, C=처리완료.
        assertThat(status("N")).isEqualTo("UNANSWERED"); // not yet answered
        assertThat(status("P")).isEqualTo("UNANSWERED"); // in progress — still needs action
        assertThat(status("C")).isEqualTo("ANSWERED");   // completed
        // Aliases still resolve; unknown/blank stays conservative (never guessed answered).
        assertThat(status("answered")).isEqualTo("ANSWERED");
        assertThat(status("COMPLETED")).isEqualTo("ANSWERED");
        assertThat(status("some-unseen-token")).isEqualTo("UNANSWERED");
        assertThat(status(null)).isEqualTo("UNANSWERED");
        assertThat(status("  ")).isEqualTo("UNANSWERED");
    }

    @Test
    void completedTokenCMapsToAnswered() {
        // Cafe24's official 처리완료 token 'C' must map to ANSWERED, with the raw token
        // preserved verbatim in informStatus. (Synthetic: raw 'C' is not yet live-observed.)
        CanonicalInquiry q =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(283L, "제목", "본문", 5L, null, "C"), 1);
        assertThat(q.status()).isEqualTo("ANSWERED");
        assertThat(q.informStatus()).isEqualTo("C");
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

    @Test
    void derivesIsSecretFailClosedFromTheSecretFlag() {
        // Only a positively-public flag reads public; everything else is secret (fail-closed).
        assertThat(secretFlag("F")).isFalse();
        assertThat(secretFlag("f")).isFalse();
        assertThat(secretFlag("false")).isFalse();
        assertThat(secretFlag("T")).isTrue();      // 비밀글
        assertThat(secretFlag(null)).isTrue();     // absent flag → secret
        assertThat(secretFlag("")).isTrue();
        assertThat(secretFlag("   ")).isTrue();
        assertThat(secretFlag("X")).isTrue();      // unrecognized/changed → secret
    }

    private static Boolean secretFlag(String secret) {
        Cafe24BoardArticleRow row =
                new Cafe24BoardArticleRow(1L, "t", "b", 1L, null, null, null, "N", secret);
        return Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row, 1).isSecret();
    }

    private static String status(String replyStatus) {
        return Cafe24InquiryArticleMapper
                .toCanonicalInquiry(6, row(1L, "t", "b", 1L, null, replyStatus), 1)
                .status();
    }
}
