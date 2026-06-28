package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Fixture-based parser/mapper tests for the INQUIRY skeleton. All fixtures are
 * <b>synthetic</b> — no captured live response, no real buyer/order/product
 * identifiers — and field bindings are provisional (INQUIRY = NEEDS_VERIFICATION).
 */
class EsmInquiryParserTest {

    private final EsmInquiryParser parser = new EsmInquiryParser();

    // Synthetic page: item 1 has an offset-bearing timestamp; item 2 omits
    // product/sku, is timezone-less, and carries an unknown extra field.
    private static final String FIXTURE = """
            {
              "items": [
                {
                  "inquiryId": "INQ-1001",
                  "qnaType": "PRODUCT",
                  "itemName": "테스트 상품 A",
                  "itemNo": "SKU-A",
                  "buyerId": "buyer-001",
                  "contents": "배송 언제 되나요",
                  "status": "미처리",
                  "regDate": "2026-06-27T10:15:00+09:00"
                },
                {
                  "inquiryId": "INQ-1002",
                  "qnaType": "PRODUCT",
                  "buyerId": "buyer-002",
                  "contents": "교환 가능한가요",
                  "status": "처리완료",
                  "regDate": "2026-06-27 09:00:00",
                  "extraUnknown": "ignored"
                }
              ],
              "totalCount": 5,
              "page": 1,
              "pageSize": 2
            }
            """;

    @Test
    void parsesEnvelopeAndDerivesHasMore() {
        EsmInquiryResponse response = parser.parse(FIXTURE);
        assertThat(response.items()).hasSize(2);
        assertThat(response.totalCount()).isEqualTo(5);
        assertThat(response.page()).isEqualTo(1);
        assertThat(response.pageSize()).isEqualTo(2);
        // page 1 of size 2 covers 2 of 5 => more remain.
        assertThat(response.hasMore()).isTrue();
    }

    @Test
    void mapsFirstItemWithStatusAndOffsetTimestamp() {
        List<CanonicalInquiry> mapped = parser.toCanonical(parser.parse(FIXTURE));
        CanonicalInquiry first = mapped.get(0);
        assertThat(first.externalId()).isEqualTo("INQ-1001");
        assertThat(first.productName()).isEqualTo("테스트 상품 A");
        assertThat(first.sku()).isEqualTo("SKU-A");
        assertThat(first.author()).isEqualTo("buyer-001");
        assertThat(first.body()).isEqualTo("배송 언제 되나요");
        assertThat(first.status()).isEqualTo("UNANSWERED");
        assertThat(first.sourceRow()).isEqualTo(1);
        // +09:00 10:15 == 01:15Z.
        assertThat(first.receivedAt()).isEqualTo(Instant.parse("2026-06-27T01:15:00Z"));
    }

    @Test
    void mapsSecondItemWithFallbackProductAndUnknownTimezone() {
        List<CanonicalInquiry> mapped = parser.toCanonical(parser.parse(FIXTURE));
        CanonicalInquiry second = mapped.get(1);
        assertThat(second.externalId()).isEqualTo("INQ-1002");
        // No itemName/itemNo => placeholder product, null sku.
        assertThat(second.productName()).isEqualTo("(미지정 상품)");
        assertThat(second.sku()).isNull();
        assertThat(second.status()).isEqualTo("ANSWERED");
        assertThat(second.sourceRow()).isEqualTo(2);
        // Timezone-less timestamp stays unknown (no KST assumption).
        assertThat(second.receivedAt()).isNull();
    }

    @Test
    void emptyOrNullResponseMapsToEmptyList() {
        assertThat(parser.toCanonical(null)).isEmpty();
        assertThat(parser.toCanonical(parser.parse("{\"items\": []}"))).isEmpty();
    }

    @Test
    void invalidBodyThrowsWithoutEchoingContent() {
        assertThatThrownBy(() -> parser.parse("not json"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("문의 응답")
                .hasMessageNotContaining("not json");
    }
}
