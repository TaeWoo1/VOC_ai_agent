package com.sellerops.ingest.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.parse.ParsedTable;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RowMapperTest {

    private final ReviewRowMapper reviewMapper = new ReviewRowMapper();
    private final InquiryRowMapper inquiryMapper = new InquiryRowMapper();
    private final OrderSummaryRowMapper orderMapper = new OrderSummaryRowMapper();

    private static ParsedTable table(List<String> headers, List<Map<String, String>> rows) {
        return new ParsedTable(headers, rows);
    }

    @Test
    void mapsKoreanReviewHeadersAndDerivesNegative() {
        MapResult<CanonicalReview> r = reviewMapper.map(table(
                List.of("상품명", "평점", "내용", "작성일", "리뷰id"),
                List.of(
                        Map.of("상품명", "전선몰딩 1호", "평점", "1", "내용", "접착력이 약해요",
                                "작성일", "2026-06-01", "리뷰id", "RV-1"),
                        Map.of("상품명", "전선몰딩 1호", "평점", "5", "내용", "설치가 쉬웠어요",
                                "작성일", "2026-06-02", "리뷰id", "RV-2"))));

        assertThat(r.errors()).isEmpty();
        assertThat(r.ok()).hasSize(2);
        assertThat(r.ok().get(0).rating()).isEqualTo(1);
        assertThat(r.ok().get(0).externalId()).isEqualTo("RV-1");
    }

    @Test
    void mapsNaverReviewExportHeaders() {
        // Synthetic rows shaped like a NAVER seller-center review export. Sensitive
        // columns (상품주문번호 / 등록자) are present but have no canonical slot, so they
        // are never mapped — verified structurally by CanonicalReview's fields.
        MapResult<CanonicalReview> r = reviewMapper.map(table(
                List.of("리뷰글번호", "상품번호", "상품명", "구매자평점", "리뷰상세내용",
                        "리뷰등록일", "상품주문번호", "등록자"),
                List.of(Map.of(
                        "리뷰글번호", "RV-1001",
                        "상품번호", "SKU-77",
                        "상품명", "전선몰딩 1호",
                        "구매자평점", "5",
                        "리뷰상세내용", "설치가 쉬웠어요",
                        "리뷰등록일", "2026.01.02. 09:08:07",
                        "상품주문번호", "ORDER-SHOULD-NOT-PERSIST",
                        "등록자", "REVIEWER-SHOULD-NOT-PERSIST"))));

        assertThat(r.errors()).isEmpty();
        assertThat(r.ok()).hasSize(1);
        CanonicalReview row = r.ok().get(0);
        assertThat(row.externalId()).isEqualTo("RV-1001");
        assertThat(row.sku()).isEqualTo("SKU-77");
        assertThat(row.productName()).isEqualTo("전선몰딩 1호");
        assertThat(row.rating()).isEqualTo(5);
        assertThat(row.body()).isEqualTo("설치가 쉬웠어요");
        // NAVER dotted date "2026.01.02." parses to start-of-day UTC; time dropped.
        assertThat(row.receivedAt())
                .isEqualTo(java.time.Instant.parse("2026-01-02T00:00:00Z"));
    }

    @Test
    void reportsRowErrorWhenNaverReviewBodyMissing() {
        MapResult<CanonicalReview> r = reviewMapper.map(table(
                List.of("리뷰글번호", "상품명", "구매자평점", "리뷰상세내용"),
                List.of(Map.of("리뷰글번호", "RV-2", "상품명", "전선몰딩 1호",
                        "구매자평점", "5", "리뷰상세내용", ""))));

        assertThat(r.ok()).isEmpty();
        assertThat(r.errors()).hasSize(1);
        assertThat(r.errors().get(0).rowNumber()).isEqualTo(2);
    }

    @Test
    void reportsRowErrorWhenReviewBodyMissing() {
        MapResult<CanonicalReview> r = reviewMapper.map(table(
                List.of("상품명", "평점", "내용"),
                List.of(Map.of("상품명", "전선몰딩 1호", "평점", "5", "내용", ""))));

        assertThat(r.ok()).isEmpty();
        assertThat(r.errors()).hasSize(1);
        assertThat(r.errors().get(0).rowNumber()).isEqualTo(2);
    }

    // --- ESM+ REVIEW (Backend Slice 1: synthetic, test-only) --------------------
    // We never recorded ESM+'s real REVIEW header strings — Policy A captured only
    // sanitized category tallies. So EVERY header and value in the ESM+ tests below
    // is a fake synthetic stand-in, never a real ESM+ header or real review/product/
    // buyer/order/contact value. These tests add no production alias; they pin the
    // invariants that hold regardless of the exact strings and document what the
    // current channel-agnostic alias set already covers. schemaMappingConfirmed:false.

    @Test
    void mapsEsmSyntheticReviewWhenCategoriesReuseGenericHeaders() {
        // Documents: IF an ESM+ export reuses a generic term already in the alias
        // set, the current mapper handles it with no production change. Also pins
        // the exclusion invariant — replyStatus, the order/buyer PII columns, and
        // the unknown columns have no CanonicalReview slot and never leak.
        String replyStatus = "REPLY-STATUS-MUST-NOT-PERSIST";
        String order = "ORDER-MUST-NOT-PERSIST";
        String buyer = "BUYER-MUST-NOT-PERSIST";
        String contact = "CONTACT-MUST-NOT-PERSIST";
        String unknown1 = "UNKNOWN1-MUST-NOT-PERSIST";
        String unknown2 = "UNKNOWN2-MUST-NOT-PERSIST";

        MapResult<CanonicalReview> r = reviewMapper.map(table(
                List.of("리뷰내용", "상품명", "상품번호", "평점", "작성일", "review_id",
                        "esm_답변상태_합성", "esm_주문번호_합성", "esm_구매자_합성",
                        "esm_연락처_합성", "esm_미상1_합성", "esm_미상2_합성"),
                List.of(Map.ofEntries(
                        Map.entry("리뷰내용", "합성-리뷰-본문"),
                        Map.entry("상품명", "합성-상품-1호"),
                        Map.entry("상품번호", "SKU-합성-1"),
                        Map.entry("평점", "4"),
                        Map.entry("작성일", "2026-02-03"),
                        Map.entry("review_id", "RV-합성-1"),
                        Map.entry("esm_답변상태_합성", replyStatus),
                        Map.entry("esm_주문번호_합성", order),
                        Map.entry("esm_구매자_합성", buyer),
                        Map.entry("esm_연락처_합성", contact),
                        Map.entry("esm_미상1_합성", unknown1),
                        Map.entry("esm_미상2_합성", unknown2)))));

        assertThat(r.errors()).isEmpty();
        assertThat(r.ok()).hasSize(1);
        CanonicalReview row = r.ok().get(0);
        assertThat(row.body()).isEqualTo("합성-리뷰-본문");
        assertThat(row.productName()).isEqualTo("합성-상품-1호");
        assertThat(row.sku()).isEqualTo("SKU-합성-1");
        assertThat(row.rating()).isEqualTo(4);
        assertThat(row.receivedAt())
                .isEqualTo(java.time.Instant.parse("2026-02-03T00:00:00Z"));
        assertThat(row.externalId()).isEqualTo("RV-합성-1");
        // Exclusion invariant: no excluded-column value reaches any canonical field.
        assertThat(row.productName()).isNotIn(replyStatus, order, buyer, contact, unknown1, unknown2);
        assertThat(row.sku()).isNotIn(replyStatus, order, buyer, contact, unknown1, unknown2);
        assertThat(row.body()).isNotIn(replyStatus, order, buyer, contact, unknown1, unknown2);
        assertThat(row.externalId()).isNotIn(replyStatus, order, buyer, contact, unknown1, unknown2);
    }

    @Test
    void documentsEsmCoverageGapsWhenNonBodyHeadersUnrecognized() {
        // Body reuses a recognized generic term (so the row maps), but product /
        // sku / rating / date / externalId use fake ESM+-specific header names the
        // CURRENT alias set does not know. Documents the coverage GAPS a future,
        // capture-grounded alias slice must close: unrecognized non-body categories
        // fall back to defaults/null. Intentional canaries — adding an alias later
        // flips these assertions, signalling the gap closed.
        MapResult<CanonicalReview> r = reviewMapper.map(table(
                List.of("리뷰내용", "esm_상품_합성", "esm_평점_합성",
                        "esm_등록일_합성", "esm_리뷰번호_합성"),
                List.of(Map.of(
                        "리뷰내용", "합성-리뷰-본문",
                        "esm_상품_합성", "합성-상품-1호",
                        "esm_평점_합성", "4",
                        "esm_등록일_합성", "2026-02-03",
                        "esm_리뷰번호_합성", "RV-합성-1"))));

        assertThat(r.errors()).isEmpty();
        assertThat(r.ok()).hasSize(1);
        CanonicalReview row = r.ok().get(0);
        assertThat(row.body()).isEqualTo("합성-리뷰-본문"); // recognized → maps
        // Gaps: unrecognized headers do not map.
        assertThat(row.productName()).isEqualTo("(미지정 상품)"); // product+sku unknown → default
        assertThat(row.sku()).isNull();
        assertThat(row.rating()).isNull();
        assertThat(row.receivedAt()).isNull();
        assertThat(row.externalId()).isNull();
    }

    @Test
    void esmRowWithBlankBodyFailsClosedWhileOtherRowsMap() {
        // Body is the only hard-required field: a row whose review-text value is
        // blank fails closed as a RowError (never silently dropped) while other
        // rows in the same synthetic export still map.
        MapResult<CanonicalReview> r = reviewMapper.map(table(
                List.of("리뷰내용", "상품명", "평점", "작성일", "review_id"),
                List.of(
                        Map.of("리뷰내용", "", "상품명", "합성-상품-1호", "평점", "5",
                                "작성일", "2026-02-03", "review_id", "RV-합성-A"),
                        Map.of("리뷰내용", "합성-리뷰-본문", "상품명", "합성-상품-1호", "평점", "5",
                                "작성일", "2026-02-04", "review_id", "RV-합성-B"))));

        assertThat(r.ok()).hasSize(1);
        assertThat(r.ok().get(0).externalId()).isEqualTo("RV-합성-B");
        assertThat(r.errors()).hasSize(1);
        assertThat(r.errors().get(0).rowNumber()).isEqualTo(2); // blank-body row = file row 2
    }

    @Test
    void mapsInquiryStatusFromKorean() {
        MapResult<CanonicalInquiry> r = inquiryMapper.map(table(
                List.of("상품명", "문의내용", "상태"),
                List.of(
                        Map.of("상품명", "A", "문의내용", "곡면 가능?", "상태", "미답변"),
                        Map.of("상품명", "A", "문의내용", "재고 있나요?", "상태", "답변완료"))));

        assertThat(r.ok()).hasSize(2);
        assertThat(r.ok().get(0).status()).isEqualTo("UNANSWERED");
        assertThat(r.ok().get(1).status()).isEqualTo("ANSWERED");
    }

    @Test
    void mapsOrderSummaryAndStripsCommas() {
        MapResult<CanonicalOrderSummary> r = orderMapper.map(table(
                List.of("날짜", "주문수", "매출액"),
                List.of(Map.of("날짜", "2026-06-01", "주문수", "42", "매출액", "567,000원"))));

        assertThat(r.errors()).isEmpty();
        assertThat(r.ok()).hasSize(1);
        assertThat(r.ok().get(0).orderCount()).isEqualTo(42);
        assertThat(r.ok().get(0).salesAmount()).isEqualTo(567_000L);
    }

    @Test
    void reportsOrderRowErrorWhenDateMissing() {
        MapResult<CanonicalOrderSummary> r = orderMapper.map(table(
                List.of("날짜", "주문수"),
                List.of(Map.of("날짜", "", "주문수", "10"))));

        assertThat(r.ok()).isEmpty();
        assertThat(r.errors()).hasSize(1);
    }
}
