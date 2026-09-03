package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The exchange/return distinction: refusal-only, read from text, and unable to admit anything.
 *
 * <p>Measured cause: a question about 반품 배송비 took an exchange policy at similarity 0.51, which
 * would have told the customer 왕복 6000원 — the exchange fee — as their return fee of 3000원. Two
 * remedies, two fees, two answers.
 */
class KnowledgeTopicRemedyTest {

    @Test
    @DisplayName("a return question is not answered by a document that is only about exchanges")
    void differentRemediesDoNotGroundEachOther() {
        assertThat(KnowledgeTopic.remedyApplicable("반품 배송비는 얼마인가요?", "교환 안내")).isFalse();
        assertThat(KnowledgeTopic.remedyApplicable("환불 받고 싶어요", "교환 안내")).isFalse();
        assertThat(KnowledgeTopic.remedyApplicable("교환하고 싶은데요", "반품과 환불 안내")).isFalse();
    }

    @Test
    @DisplayName("a document that names both remedies grounds either question")
    void oneDocumentMayCoverBoth() {
        assertThat(KnowledgeTopic.remedyApplicable("반품하고 싶어요", "교환 및 반품 안내")).isTrue();
        assertThat(KnowledgeTopic.remedyApplicable("교환하고 싶어요", "교환 및 반품 안내")).isTrue();
    }

    @Test
    @DisplayName("silence on either side refuses nothing")
    void itOnlyEverRefuses() {
        // The question names no remedy: nothing to disagree with.
        assertThat(KnowledgeTopic.remedyApplicable("배송 언제 되나요?", "교환 안내")).isTrue();
        // The document names no remedy: a FAQ or a description is never refused on this axis.
        assertThat(KnowledgeTopic.remedyApplicable("반품하고 싶어요", "자주 묻는 질문")).isTrue();
        assertThat(KnowledgeTopic.remedyApplicable(null, "교환 안내")).isTrue();
        assertThat(KnowledgeTopic.remedyApplicable("반품", null)).isTrue();
    }

    @Test
    @DisplayName("the wire vocabulary is untouched — one bucket for a seller's filter, two for grounding")
    void theEnumStillHasOneBucket() {
        // EXCHANGE_RETURN is a plan token and an inbox filter; splitting it would change what a
        // seller sees when they filter 「교환·반품」, which is a different decision from this one.
        assertThat(KnowledgeTopic.of("반품")).containsExactly(KnowledgeTopic.EXCHANGE_RETURN);
        assertThat(KnowledgeTopic.of("교환")).containsExactly(KnowledgeTopic.EXCHANGE_RETURN);
    }
}
