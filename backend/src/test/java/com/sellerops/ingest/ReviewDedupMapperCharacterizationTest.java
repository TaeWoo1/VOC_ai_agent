package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.map.MapResult;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.parse.ParsedTable;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Milestone R1 (dedup repeatability gate) — offline synthetic hardening of two
 * mapper-level identity properties, computed through the REAL production key
 * ({@link ReviewDedupKey#contentHash}, v2):
 *
 * <ul>
 *   <li><b>Date canonicalization:</b> equivalent source date-string formats
 *       ({@code -}/{@code /}/{@code .}/{@code yyyyMMdd}/trailing-dot/with-time) all
 *       resolve to the same start-of-day instant → the SAME key; a genuinely
 *       different day → a different key. (Dates canonicalize to UTC start-of-day —
 *       neutral, no KST assumption.)</li>
 *   <li><b>Mutable-attribute exclusion:</b> the reply-status / order / buyer
 *       columns have no canonical slot, so rows differing ONLY in those columns
 *       map to identical identity fields → the SAME key. This is the code-level
 *       proof that "identity must not move when only the reply changes."</li>
 * </ul>
 *
 * Pure (no DB); synthetic rows only. All rows share one product, so a fixed
 * {@code PRODUCT} UUID faithfully stands in for the per-row resolved productId.
 * These harden code properties; they do NOT confirm dedup ({@code
 * dedupKeyConfirmed} stays false pending live R2 evidence).
 */
class ReviewDedupMapperCharacterizationTest {

    private final ReviewRowMapper mapper = new ReviewRowMapper();

    private static final UUID CHANNEL = UUID.randomUUID();
    private static final UUID PRODUCT = UUID.randomUUID();

    // --- Date canonicalization -------------------------------------------------------------------

    @Test
    void equivalentDateStringFormatsCanonicalizeToTheSameKey() {
        List<String> dateVariants = List.of(
                "2026-02-03", "2026/02/03", "2026.02.03", "20260203",
                "2026.02.03.", "2026-02-03 09:08:07");

        List<CanonicalReview> rows = mapDateVariants(dateVariants);
        assertThat(rows).hasSize(dateVariants.size());

        Instant expected = Instant.parse("2026-02-03T00:00:00Z");
        String expectedKey = keyFor(rows.get(0));
        for (CanonicalReview row : rows) {
            assertThat(row.receivedAt()).isEqualTo(expected);
            assertThat(keyFor(row)).isEqualTo(expectedKey);
        }
    }

    @Test
    void aGenuinelyDifferentDayProducesADifferentKey() {
        List<CanonicalReview> rows = mapDateVariants(List.of("2026-02-03", "2026-02-04"));
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).receivedAt()).isNotEqualTo(rows.get(1).receivedAt());
        assertThat(keyFor(rows.get(0))).isNotEqualTo(keyFor(rows.get(1)));
    }

    // --- Mutable-attribute (replyStatus / PII) exclusion from identity --------------------------

    @Test
    void replyStatusAndPiiColumnsAreExcludedFromTheIdentityKey() {
        // Two rows: identical mapped fields, differing ONLY in the excluded columns.
        String bodyVal = "합성-리뷰-본문";
        CanonicalReview beforeReply = mapOneEsmRow(bodyVal, "REPLY-BEFORE", "ORDER-1", "BUYER-1");
        CanonicalReview afterReply = mapOneEsmRow(bodyVal, "REPLY-AFTER", "ORDER-2", "BUYER-2");

        // Identity inputs are unchanged by the mutable/PII columns…
        assertThat(afterReply.body()).isEqualTo(beforeReply.body());
        assertThat(afterReply.productName()).isEqualTo(beforeReply.productName());
        assertThat(afterReply.sku()).isEqualTo(beforeReply.sku());
        assertThat(afterReply.rating()).isEqualTo(beforeReply.rating());
        assertThat(afterReply.receivedAt()).isEqualTo(beforeReply.receivedAt());
        // …so the production key does not move when only the reply/PII columns change.
        assertThat(keyFor(afterReply)).isEqualTo(keyFor(beforeReply));

        // Exclusion invariant: no excluded value leaked into an identity field.
        for (CanonicalReview r : List.of(beforeReply, afterReply)) {
            assertThat(r.body()).doesNotContain("REPLY", "ORDER", "BUYER");
            assertThat(r.productName()).doesNotContain("REPLY", "ORDER", "BUYER");
            assertThat(r.sku()).doesNotContain("REPLY", "ORDER", "BUYER");
        }
    }

    // --- helpers --------------------------------------------------------------------------------

    /** Map N synthetic ESM+ rows that differ only in the date column's string format. */
    private List<CanonicalReview> mapDateVariants(List<String> dates) {
        List<String> headers = List.of("리뷰내용", "상품명", "상품번호", "별점", "접수일시");
        List<Map<String, String>> rows = new ArrayList<>();
        for (String date : dates) {
            Map<String, String> row = new LinkedHashMap<>();
            row.put("리뷰내용", "합성-리뷰-본문");
            row.put("상품명", "합성-상품-1호");
            row.put("상품번호", "SKU-합성-1");
            row.put("별점", "5");
            row.put("접수일시", date);
            rows.add(row);
        }
        MapResult<CanonicalReview> r = mapper.map(new ParsedTable(headers, rows));
        assertThat(r.errors()).isEmpty();
        return r.ok();
    }

    /** Map one synthetic ESM+ row with the given body plus differing excluded-column values. */
    private CanonicalReview mapOneEsmRow(String body, String reply, String order, String buyer) {
        List<String> headers = List.of("리뷰내용", "상품명", "상품번호", "별점", "접수일시",
                "esm_답변상태_합성", "esm_주문번호_합성", "esm_구매자_합성");
        Map<String, String> row = new LinkedHashMap<>();
        row.put("리뷰내용", body);
        row.put("상품명", "합성-상품-1호");
        row.put("상품번호", "SKU-합성-1");
        row.put("별점", "5");
        row.put("접수일시", "2026-02-03");
        row.put("esm_답변상태_합성", reply);
        row.put("esm_주문번호_합성", order);
        row.put("esm_구매자_합성", buyer);
        MapResult<CanonicalReview> r = mapper.map(new ParsedTable(headers, List.of(row)));
        assertThat(r.errors()).isEmpty();
        assertThat(r.ok()).hasSize(1);
        return r.ok().get(0);
    }

    /** Compute the production v2 REVIEW key for a mapped row (fixed channel/product stand-ins). */
    private static String keyFor(CanonicalReview row) {
        return ReviewDedupKey.contentHash(ReviewDedupKey.V2, CHANNEL, PRODUCT,
                datePart(row.receivedAt()), row.body(), row.rating());
    }

    /** Mirrors {@code IngestionService.datePart}: the first 10 chars of the ISO-8601 instant. */
    private static String datePart(Instant receivedAt) {
        return receivedAt == null ? "" : receivedAt.toString().substring(0, 10);
    }
}
