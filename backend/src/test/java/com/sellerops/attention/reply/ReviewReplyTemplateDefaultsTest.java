package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.reply.ReviewReplyProposalProvider.ReviewReplyContext;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The relocation test.</b> Review Reply Template Settings v1 moved the six review reply templates
 * out of {@link RuleBasedReviewReplyProvider} and into {@link ReviewReplyTemplateKey} so an
 * organization could own the wording. The bodies below are the ones that were compiled into the
 * provider before that move, written out here as literals: if a later edit reworded a default, this
 * test is what says so, and the reword becomes a decision rather than a diff nobody read.
 *
 * <p>The keyword lists and their order are pinned for the same reason — they are the rule that picks
 * a template, and a settings screen that lets a seller rewrite the words must not quietly change
 * which review gets which one.
 */
class ReviewReplyTemplateDefaultsTest {

    @Test
    @DisplayName("the seven shipped bodies are byte-identical to the wording the provider had")
    void defaultsAreUnchanged() {
        assertThat(ReviewReplyTemplateKey.POSITIVE.defaultBody()).isEqualTo(
                "안녕하세요, 고객님. 좋은 후기를 남겨주셔서 진심으로 감사합니다. "
                        + "앞으로도 만족하실 수 있도록 노력하겠습니다.");
        assertThat(ReviewReplyTemplateKey.QUALITY.defaultBody()).isEqualTo(
                "안녕하세요, 고객님. 상품에 문제가 있어 불편을 드린 점 진심으로 사과드립니다. "
                        + "말씀해 주신 내용을 확인한 뒤 필요한 조치를 안내드리겠습니다. 알려주셔서 감사합니다.");
        assertThat(ReviewReplyTemplateKey.DELIVERY.defaultBody()).isEqualTo(
                "안녕하세요, 고객님. 상품을 받아보시기까지 불편을 드린 점 사과드립니다. "
                        + "배송 과정을 다시 살펴보고 개선하겠습니다. 소중한 의견 남겨주셔서 감사합니다.");
        assertThat(ReviewReplyTemplateKey.PACKAGING.defaultBody()).isEqualTo(
                "안녕하세요, 고객님. 포장 상태로 불편을 드려 죄송합니다. "
                        + "포장 방식을 다시 점검하겠습니다. 알려주셔서 감사합니다.");
        assertThat(ReviewReplyTemplateKey.PRODUCT_INFO.defaultBody()).isEqualTo(
                "안녕하세요, 고객님. 상품 정보가 기대하신 것과 달라 실망을 드린 점 사과드립니다. "
                        + "상품 설명을 다시 점검해 더 정확히 안내하겠습니다. 의견 감사합니다.");
        assertThat(ReviewReplyTemplateKey.PRICING.defaultBody()).isEqualTo(
                "안녕하세요, 고객님. 가격에 대한 의견 감사합니다. "
                        + "더 나은 가치를 드릴 수 있도록 계속 고민하겠습니다.");
        assertThat(ReviewReplyTemplateKey.GENERAL.defaultBody()).isEqualTo(
                "안녕하세요, 고객님. 소중한 후기를 남겨주셔서 감사합니다. "
                        + "남겨주신 의견을 잘 살펴보고 반영하겠습니다.");
    }

    @Test
    @DisplayName("the taxonomy is the same seven categories, under the same names")
    void categoriesAreUnchanged() {
        assertThat(ReviewReplyTemplateKey.values()).extracting(ReviewReplyTemplateKey::category)
                .containsExactly("positive_reply", "quality_reply", "delivery_reply",
                        "packaging_reply", "product_info_reply", "pricing_reply", "general_reply");
        assertThat(ReviewReplyTemplateKey.POSITIVE.category())
                .isEqualTo(RuleBasedReviewReplyProvider.POSITIVE_CATEGORY);
        assertThat(ReviewReplyTemplateKey.GENERAL.category())
                .isEqualTo(RuleBasedReviewReplyProvider.DEFAULT_CATEGORY);
    }

    @Test
    @DisplayName("the keyword lists and the order they are tried in are unchanged")
    void keywordsAndOrderAreUnchanged() {
        assertThat(ReviewReplyTemplateKey.KEYWORD_ORDER).containsExactly(
                ReviewReplyTemplateKey.QUALITY, ReviewReplyTemplateKey.DELIVERY,
                ReviewReplyTemplateKey.PACKAGING, ReviewReplyTemplateKey.PRODUCT_INFO,
                ReviewReplyTemplateKey.PRICING);
        assertThat(ReviewReplyTemplateKey.QUALITY.keywords())
                .containsExactly("불량", "하자", "깨짐", "파손", "터짐", "고장", "품질");
        assertThat(ReviewReplyTemplateKey.DELIVERY.keywords())
                .containsExactly("배송", "택배", "발송", "도착", "출고", "지연");
        assertThat(ReviewReplyTemplateKey.PACKAGING.keywords())
                .containsExactly("포장", "박스", "완충");
        assertThat(ReviewReplyTemplateKey.PRODUCT_INFO.keywords())
                .containsExactly("설명", "사양", "스펙", "사진", "상이", "다릅", "달라요");
        assertThat(ReviewReplyTemplateKey.PRICING.keywords())
                .containsExactly("가격", "비싸", "할인", "가성비");
        // The two chosen without words: one by rating, one by falling through.
        assertThat(ReviewReplyTemplateKey.POSITIVE.keywords()).isEmpty();
        assertThat(ReviewReplyTemplateKey.GENERAL.keywords()).isEmpty();
    }

    @Test
    @DisplayName("selection is unchanged: rating first, then keywords in order, then the fallback")
    void selectionIsUnchanged() {
        assertThat(keyFor("배송 빨라요! 포장도 좋았고 가격도 만족합니다", 5)).isEqualTo(ReviewReplyTemplateKey.POSITIVE);
        assertThat(keyFor("불량이 있었지만 교환은 빨랐어요", 4)).isEqualTo(ReviewReplyTemplateKey.POSITIVE);
        assertThat(keyFor("상품이 불량입니다", 1)).isEqualTo(ReviewReplyTemplateKey.QUALITY);
        assertThat(keyFor("배송이 너무 늦어요", 2)).isEqualTo(ReviewReplyTemplateKey.DELIVERY);
        assertThat(keyFor("포장이 엉망이었어요", 2)).isEqualTo(ReviewReplyTemplateKey.PACKAGING);
        assertThat(keyFor("설명이랑 너무 달라요", 2)).isEqualTo(ReviewReplyTemplateKey.PRODUCT_INFO);
        assertThat(keyFor("가격이 너무 비싸요", 3)).isEqualTo(ReviewReplyTemplateKey.PRICING);
        assertThat(keyFor("합성-리뷰-본문: 특별히 할 말은 없습니다", 3)).isEqualTo(ReviewReplyTemplateKey.GENERAL);
    }

    /** No default promises a refund, an exchange, a discount or a date — and none blames the customer. */
    @Test
    @DisplayName("no shipped template commits to anything")
    void noDefaultPromisesAnything() {
        // 「할인」 is deliberately absent from this list: it is a pricing KEYWORD, and the pricing
        // default answers a price remark without offering one.
        List<String> promises = List.of("환불", "교환해", "반품해", "할인해", "쿠폰", "보상", "내일", "이틀 안");
        for (ReviewReplyTemplateKey key : ReviewReplyTemplateKey.values()) {
            for (String promise : promises) {
                assertThat(key.defaultBody()).as("%s must not promise %s", key, promise)
                        .doesNotContain(promise);
            }
        }
    }

    private static ReviewReplyTemplateKey keyFor(String body, Integer rating) {
        return RuleBasedReviewReplyProvider.keyFor(
                new ReviewReplyContext(UUID.randomUUID(), UUID.randomUUID(), body, rating));
    }
}
