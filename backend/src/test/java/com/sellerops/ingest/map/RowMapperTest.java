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
