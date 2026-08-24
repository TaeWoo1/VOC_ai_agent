package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The PII fence on Answer Memory's key.
 *
 * <p>Answer memory is long-lived by design, and the obvious key for it — the customer's question —
 * is where the name, the address, the phone number and the order number live. These tests are the
 * fence: a token reaches the signature only if the seller's own writing already contains it, and no
 * token carrying a digit reaches it at all.
 */
class TopicSignatureTest {

    /** The seller's own writing: a shipping policy and a receipt policy, normalized. */
    private static final String CORPUS = KnowledgeText.normalize(
            "배송 안내 주문 후 영업일 기준 2일 이내 출고됩니다 배송비는 3000원입니다")
            + KnowledgeText.normalize("현금영수증 안내 결제 후 현금영수증 발급을 요청하실 수 있습니다");

    @Test
    @DisplayName("the topic words survive — they are what the signature is for")
    void topicWordsSurvive() {
        assertThat(TopicSignature.of("현금영수증 발급 가능한가요?", CORPUS))
                .contains("현금영수증")
                .contains("발급");
    }

    @Test
    @DisplayName("a buyer's name, address and phone number cannot enter the key")
    void buyerIdentifiersCannotEnterTheKey() {
        String signature = TopicSignature.of(
                "홍길동입니다. 서울시 강남구 테헤란로. 010-1234-5678. 배송 문의드립니다.", CORPUS);

        assertThat(signature).as("the seller's shipping policy does not contain a buyer")
                .doesNotContain("홍길동").doesNotContain("서울").doesNotContain("강남")
                .doesNotContain("테헤란").doesNotContain("010").doesNotContain("1234");
        assertThat(signature).as("what the question was ABOUT is what remains").contains("배송");
    }

    @Test
    @DisplayName("an order number is dropped before the corpus is even consulted")
    void digitsAreDroppedRegardless() {
        // 3000 IS in the seller's shipping policy, so the corpus check alone would let it through.
        // The digit rule fires first, which is why it is a separate rule and not an accident.
        assertThat(TopicSignature.of("주문번호 20260824-0001 건 배송비 3000원 문의", CORPUS))
                .doesNotContain("3000").doesNotContain("20260824").doesNotContain("0001");
    }

    @Test
    @DisplayName("a seller who has written nothing gets an empty signature, not a copy of the question")
    void anEmptyCorpusYieldsAnEmptySignature() {
        assertThat(TopicSignature.of("현금영수증 발급 가능한가요?", "")).isEmpty();
        assertThat(TopicSignature.of("현금영수증 발급 가능한가요?", null)).isEmpty();
    }

    @Test
    @DisplayName("the signature is bounded and deterministic")
    void boundedAndDeterministic() {
        String long_ = "배송 배송비 출고 영업일 현금영수증 발급 결제 요청 안내 주문 ".repeat(20);
        String first = TopicSignature.of(long_, CORPUS);

        assertThat(first.split(" ")).hasSizeLessThanOrEqualTo(TopicSignature.MAX_TOKENS);
        assertThat(TopicSignature.of(long_, CORPUS)).isEqualTo(first);
    }
}
