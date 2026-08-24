package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The measuring instrument, kept honest about what it is.
 *
 * <p>These cases are the shapes the Demo Org's real backlog actually contains — a tax-invoice
 * request, a "where is my parcel", a dimension question — because the number this classifier produces
 * is only useful if it recognises the backlog it is used to size. It routes nothing and no draft
 * changes because of it.
 */
class InquiryKnowledgeNeedTest {

    @Test
    @DisplayName("a policy question needs policy, and says so without needing a product")
    void policyQuestions() {
        assertThat(InquiryKnowledgeNeed.of("세금계산서 발행 요청", "사업자 등록증 첨부합니다."))
                .isEqualTo(InquiryKnowledgeNeed.ORG_POLICY_NEEDED);
        assertThat(InquiryKnowledgeNeed.of("현금영수증 발급 부탁드립니다", null))
                .isEqualTo(InquiryKnowledgeNeed.ORG_POLICY_NEEDED);
    }

    @Test
    @DisplayName("a spec question needs product knowledge")
    void productQuestions() {
        assertThat(InquiryKnowledgeNeed.of("내부 폭이 몇 mm인가요?", "전선 두 가닥이 들어가야 합니다."))
                .isEqualTo(InquiryKnowledgeNeed.PRODUCT_KNOWLEDGE_NEEDED);
    }

    @Test
    @DisplayName("\"where is my parcel\" needs the order, and no policy can substitute for it")
    void orderQuestions() {
        assertThat(InquiryKnowledgeNeed.of("배송 언제 되나요", "사흘 전에 주문했습니다."))
                .isEqualTo(InquiryKnowledgeNeed.ORDER_CONTEXT_NEEDED);
    }

    @Test
    @DisplayName("a question that needs two axes is not filed under one of them")
    void mixedQuestions() {
        assertThat(InquiryKnowledgeNeed.of("반품하려는데 배송비는 어떻게 되나요",
                "제품 색상이 사진과 다릅니다.")).isEqualTo(InquiryKnowledgeNeed.MULTI_SOURCE);
    }

    @Test
    @DisplayName("an unclassifiable question is named as such rather than filed under a guess")
    void unclassifiable() {
        assertThat(InquiryKnowledgeNeed.of("안녕하세요", "연락 부탁드립니다."))
                .isEqualTo(InquiryKnowledgeNeed.CURRENTLY_UNANSWERABLE);
        assertThat(InquiryKnowledgeNeed.of(null, null))
                .isEqualTo(InquiryKnowledgeNeed.CURRENTLY_UNANSWERABLE);
    }

    @Test
    @DisplayName("the axes are reported separately — a MULTI label cannot inflate an order total")
    void axesDoNotCollapse() {
        // The exact shape that made the 2026-08-25 audit report 31 where the truth was 29: a question
        // that needs product AND policy is MULTI_SOURCE and has nothing to do with an order.
        String title = "반품 배송비가 얼마인가요";
        String body = "제품 크기가 생각보다 커서요.";

        assertThat(InquiryKnowledgeNeed.of(title, body)).isEqualTo(InquiryKnowledgeNeed.MULTI_SOURCE);
        assertThat(InquiryKnowledgeNeed.axesOf(title, body))
                .containsExactlyInAnyOrder(InquiryKnowledgeNeed.ORG_POLICY_NEEDED,
                        InquiryKnowledgeNeed.PRODUCT_KNOWLEDGE_NEEDED)
                .doesNotContain(InquiryKnowledgeNeed.ORDER_CONTEXT_NEEDED);
    }

    @Test
    @DisplayName("axesOf and of agree on every single-axis question")
    void theCollapsedLabelIsDerivedFromTheAxes() {
        for (String question : new String[] {"세금계산서 발급해주세요", "폭이 몇 mm인가요", "언제 발송되나요"}) {
            assertThat(InquiryKnowledgeNeed.axesOf(question, null)).hasSize(1);
            assertThat(InquiryKnowledgeNeed.of(question, null))
                    .isEqualTo(InquiryKnowledgeNeed.axesOf(question, null).iterator().next());
        }
        assertThat(InquiryKnowledgeNeed.axesOf("안녕하세요", null)).isEmpty();
    }
}
