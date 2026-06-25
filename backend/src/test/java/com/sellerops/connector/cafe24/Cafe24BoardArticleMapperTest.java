package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** Board-article → CanonicalCommunityArticle mapping: source_kind, fields, timestamps. */
class Cafe24BoardArticleMapperTest {

    @Test
    void mapsBoardNumbersToSourceKind() {
        assertThat(Cafe24BoardArticleMapper.sourceKindForBoard(4)).isEqualTo("REVIEW");
        assertThat(Cafe24BoardArticleMapper.sourceKindForBoard(6)).isEqualTo("PRODUCT_INQUIRY");
        assertThat(Cafe24BoardArticleMapper.sourceKindForBoard(9)).isEqualTo("ONE_TO_ONE_INQUIRY");
        assertThat(Cafe24BoardArticleMapper.sourceKindForBoard(99)).isEqualTo("OTHER");
    }

    @Test
    void carriesAllFieldsAndPassesReplyStatusThrough() {
        Cafe24BoardArticleRow row = new Cafe24BoardArticleRow(
                1001L, "좋은 상품", "본문", 77L, 5, "2026-06-20T10:00:00+09:00", null, "N");

        CanonicalCommunityArticle out = Cafe24BoardArticleMapper.toCanonical(4, row, 3);

        assertThat(out.boardNo()).isEqualTo(4);
        assertThat(out.articleNo()).isEqualTo(1001L);
        assertThat(out.sourceKind()).isEqualTo("REVIEW");
        assertThat(out.productNo()).isEqualTo(77L);
        assertThat(out.title()).isEqualTo("좋은 상품");
        assertThat(out.content()).isEqualTo("본문");
        assertThat(out.rating()).isEqualTo(5);
        // Raw token passed through unchanged — ingestion normalizes it.
        assertThat(out.replyStatus()).isEqualTo("N");
        assertThat(out.sourceRow()).isEqualTo(3);
    }

    @Test
    void parsesOffsetBearingTimestampToInstant() {
        Cafe24BoardArticleRow row = new Cafe24BoardArticleRow(
                1L, "t", "c", null, null, "2026-06-20T10:00:00+09:00", "2026-06-21T00:00:00+09:00", "T");

        CanonicalCommunityArticle out = Cafe24BoardArticleMapper.toCanonical(4, row, 1);
        assertThat(out.sourceCreatedAt()).isEqualTo(Instant.parse("2026-06-20T01:00:00Z"));
        assertThat(out.sourceUpdatedAt()).isEqualTo(Instant.parse("2026-06-20T15:00:00Z"));
    }

    @Test
    void timezonelessOrMissingTimestampStaysNull() {
        Cafe24BoardArticleRow row = new Cafe24BoardArticleRow(
                1L, "t", "c", null, null, "2026-06-20 10:00:00", null, "T");

        CanonicalCommunityArticle out = Cafe24BoardArticleMapper.toCanonical(4, row, 1);
        // Timezone-less stays unknown (no assumed zone); missing stays null.
        assertThat(out.sourceCreatedAt()).isNull();
        assertThat(out.sourceUpdatedAt()).isNull();
    }

    @Test
    void nullRatingAndProductTolerated() {
        Cafe24BoardArticleRow row = new Cafe24BoardArticleRow(
                1L, "t", "c", null, null, null, null, null);

        CanonicalCommunityArticle out = Cafe24BoardArticleMapper.toCanonical(6, row, 1);
        assertThat(out.rating()).isNull();
        assertThat(out.productNo()).isNull();
        assertThat(out.replyStatus()).isNull();
        assertThat(out.sourceKind()).isEqualTo("PRODUCT_INQUIRY");
    }
}
