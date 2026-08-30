package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Retrieval &amp; Grounding Correctness v1 — the applicability axis beside the lexical score. */
class KnowledgeTopicTest {

    @Test
    @DisplayName("a question about shipping and a document declared about returns are not applicable to each other")
    void disjointTopicsAreNotApplicable() {
        Set<KnowledgeTopic> asked = KnowledgeTopic.of("배송 기간");
        Set<KnowledgeTopic> declared = KnowledgeTopic.of("교환 및 반품 안내");
        assertThat(asked).containsExactly(KnowledgeTopic.SHIPPING);
        assertThat(declared).containsExactly(KnowledgeTopic.EXCHANGE_RETURN);
        assertThat(KnowledgeTopic.applicable(asked, declared)).isFalse();
    }

    @Test
    @DisplayName("a document that declares no topic is never rejected; a question naming none rejects nothing")
    void undeclaredNeverRejects() {
        assertThat(KnowledgeTopic.applicable(KnowledgeTopic.of("배송 기간"), KnowledgeTopic.of("자주 묻는 질문"))).isTrue();
        assertThat(KnowledgeTopic.applicable(KnowledgeTopic.of("폭이 몇 mm인가요"), KnowledgeTopic.of("교환 및 반품 안내"))).isTrue();
        assertThat(KnowledgeTopic.applicable(EnumSet.noneOf(KnowledgeTopic.class), null)).isTrue();
    }

    @Test
    @DisplayName("a question naming two topics is applicable to a document about either")
    void sharedTopicIsApplicable() {
        Set<KnowledgeTopic> asked = KnowledgeTopic.of("반품 배송비는 누가 내나요");
        assertThat(asked).contains(KnowledgeTopic.SHIPPING, KnowledgeTopic.EXCHANGE_RETURN);
        assertThat(KnowledgeTopic.applicable(asked, KnowledgeTopic.of("교환 및 반품 안내"))).isTrue();
        assertThat(KnowledgeTopic.applicable(asked, KnowledgeTopic.of("배송 안내"))).isTrue();
    }

    @Test
    @DisplayName("세금계산서 is the tax-invoice topic, not the cash-receipt one")
    void taxInvoiceIsItsOwnTopic() {
        assertThat(KnowledgeTopic.of("세금계산서 발행 부탁드립니다")).containsExactly(KnowledgeTopic.TAX_INVOICE);
        assertThat(KnowledgeTopic.of("현금영수증 부탁드립니다")).containsExactly(KnowledgeTopic.CASH_RECEIPT);
    }
}
