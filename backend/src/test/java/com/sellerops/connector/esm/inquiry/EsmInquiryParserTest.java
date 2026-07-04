package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Fixture-based parser/mapper tests for the INQUIRY skeleton. The success body is a
 * <b>top-level JSON array</b> (no pagination envelope); a failure body is the {@code
 * { resultCode, message }} shape. All fixtures are <b>synthetic</b> — no captured
 * live response, no real buyer/order/product identifiers — and field bindings are
 * official-doc confirmed but live-response unverified.
 */
class EsmInquiryParserTest {

    private final EsmInquiryParser parser = new EsmInquiryParser();

    // Synthetic array: item 1 has an offset-bearing timestamp, a title, a numeric
    // qnaType, a boolean reAsking, and a reply token that must never leak; item 2
    // omits goods refs, is timezone-less, and carries an unknown extra field.
    private static final String FIXTURE = """
            [
              {
                "messageNo": "INQ-1001",
                "qnaType": 1,
                "sellerId": "seller-9",
                "goodsNo": "SKU-A",
                "siteGoodsNo": "SITE-A",
                "orderNo": "ORD-1",
                "informStatus": "미처리",
                "receiveDate": "2026-06-27T10:15:00+09:00",
                "title": "배송 문의",
                "details": "배송 언제 되나요",
                "token": "reply-secret-should-be-discarded",
                "reAsking": false
              },
              {
                "messageNo": "INQ-1002",
                "qnaType": 2,
                "informStatus": "처리완료",
                "details": "교환 가능한가요",
                "receiveDate": "2026-06-27 09:00:00",
                "reAsking": true,
                "extraUnknown": "ignored"
              }
            ]
            """;

    @Test
    void parsesTopLevelArrayWithNumericAndBooleanWireTypes() {
        List<EsmInquiryItem> items = parser.parseItems(FIXTURE);
        assertThat(items).hasSize(2);
        assertThat(items.get(0).qnaType()).isEqualTo(1);
        assertThat(items.get(0).reAsking()).isFalse();
        assertThat(items.get(1).qnaType()).isEqualTo(2);
        assertThat(items.get(1).reAsking()).isTrue();
    }

    @Test
    void mapsFirstItemWithConfirmedFieldsStatusAndOffsetTimestamp() {
        List<CanonicalInquiry> mapped = parser.toCanonical(parser.parseItems(FIXTURE));
        CanonicalInquiry first = mapped.get(0);
        // messageNo => external id (dedup key); goodsNo => sku (no product name in the model).
        assertThat(first.externalId()).isEqualTo("INQ-1001");
        assertThat(first.sku()).isEqualTo("SKU-A");
        assertThat(first.productName()).isNull();
        assertThat(first.title()).isEqualTo("배송 문의");
        assertThat(first.body()).isEqualTo("배송 언제 되나요");
        // Raw source token preserved; canonical status derived from it.
        assertThat(first.informStatus()).isEqualTo("미처리");
        assertThat(first.status()).isEqualTo("UNANSWERED");
        // Buyer identity is not modeled and never mapped to author.
        assertThat(first.author()).isNull();
        assertThat(first.sourceRow()).isEqualTo(1);
        // +09:00 10:15 == 01:15Z.
        assertThat(first.receivedAt()).isEqualTo(Instant.parse("2026-06-27T01:15:00Z"));
    }

    @Test
    void mapsSecondItemWithFallbackProductAndUnknownTimezone() {
        List<CanonicalInquiry> mapped = parser.toCanonical(parser.parseItems(FIXTURE));
        CanonicalInquiry second = mapped.get(1);
        assertThat(second.externalId()).isEqualTo("INQ-1002");
        // No goodsNo/siteGoodsNo => placeholder product, null sku.
        assertThat(second.productName()).isEqualTo("(미지정 상품)");
        assertThat(second.sku()).isNull();
        assertThat(second.title()).isNull();
        assertThat(second.informStatus()).isEqualTo("처리완료");
        assertThat(second.status()).isEqualTo("ANSWERED");
        assertThat(second.author()).isNull();
        assertThat(second.sourceRow()).isEqualTo(2);
        // Timezone-less timestamp stays unknown (no KST assumption).
        assertThat(second.receivedAt()).isNull();
    }

    @Test
    void replyTokenNeverAppearsInTheItemToStringOrTheCanonicalRecord() {
        EsmInquiryItem item = parser.parseItems(FIXTURE).get(0);
        // The token is captured (so the row shape is complete) but redacted from toString.
        assertThat(item.token()).isEqualTo("reply-secret-should-be-discarded");
        assertThat(item.toString())
                .doesNotContain("reply-secret-should-be-discarded")
                .contains("<redacted>");
        // ...and it reaches no canonical field.
        CanonicalInquiry mapped = parser.toCanonical(parser.parseItems(FIXTURE)).get(0);
        assertThat(mapped.toString()).doesNotContain("reply-secret-should-be-discarded");
    }

    @Test
    void emptyOrNullResponseMapsToEmptyList() {
        assertThat(parser.toCanonical(null)).isEmpty();
        assertThat(parser.parseItems("[]")).isEmpty();
        assertThat(parser.toCanonical(parser.parseItems("[]"))).isEmpty();
    }

    @Test
    void parsesTheFailureShapeResultCodeAndMessage() {
        EsmInquiryError error = parser.parseError("{\"resultCode\": 4001, \"message\": \"권한 없음\"}");
        assertThat(error).isNotNull();
        assertThat(error.resultCode()).isEqualTo(4001);
        // A success (array) body or an unrelated object is not the failure shape.
        assertThat(parser.parseError("[]")).isNull();
        assertThat(parser.parseError("{\"error\":\"x\"}")).isNull();
    }

    @Test
    void invalidBodyThrowsWithoutEchoingContent() {
        assertThatThrownBy(() -> parser.parseItems("not json"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("문의 응답")
                .hasMessageNotContaining("not json");
    }
}
