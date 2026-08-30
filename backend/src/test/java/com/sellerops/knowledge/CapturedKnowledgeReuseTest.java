package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Captured Knowledge Reuse Robustness v1 (2026-08-31) — a fact the seller just stated, asked for again
 * in other words, is found by the SAME gates every other document passes; and the three closed
 * additions (topic alias · ending tails · quantity concepts) admit nothing on their own.
 *
 * <p>Every sentence below is one that was read live on 2026-08-30 and missed. The thresholds are
 * asserted unchanged; nothing here is a threshold.
 */
@DisplayName("저장한 지식의 재검색 — 같은 사실, 다른 표현")
class CapturedKnowledgeReuseTest {

    private static final String SHIP_RULE = "출고까지 보통 2~3일 걸립니다.";
    private static final String SHIP_RULE_2 = "결제 후 보통 2~3일 안에 출고합니다. 주말과 공휴일은 제외입니다.";
    private static final String RETURN_RULE = "단순 변심 반품은 수령 후 7일 이내에만 가능하며 반품 배송비는 고객 부담입니다.";
    private static final String STRANDS = "3가닥입니다.";
    private static final String STRANDS_2 = "이 몰딩에는 일반 가전 전선 기준으로 최대 3가닥까지 들어갑니다.";
    private static final String HEIGHT = "높이는 18mm, 두께는 2mm입니다.";
    private static final String PRODUCT = "QA 전선몰딩";

    private static List<KnowledgeRetriever.Candidate<String>> corpus(String... passages) {
        return java.util.Arrays.stream(passages)
                .map(p -> new KnowledgeRetriever.Candidate<>(p, KnowledgeText.normalize(p))).toList();
    }

    private static List<String> found(String question, String productName, String... passages) {
        return KnowledgeRetriever.rank(question, corpus(passages), productName).stream()
                .map(KnowledgeRetriever.Hit::ref).toList();
    }

    @Test
    @DisplayName("thresholds unchanged")
    void thresholdsUnchanged() {
        assertThat(KnowledgeRetriever.MIN_ASKABLE_RATIO).isEqualTo(0.35);
        assertThat(KnowledgeRetriever.MIN_TOPIC_COVERAGE).isEqualTo(0.4);
        assertThat(KnowledgeRetriever.MIN_MATCHED_CHARS).isEqualTo(2);
    }

    @Test
    @DisplayName("A/B/C — 배송·출고·발송 are one topic: the customer's 배송 finds the seller's 출고 rule")
    void shippingAliasFindsTheSavedRule() {
        assertThat(found("배송은 며칠 걸리나요?", null, SHIP_RULE)).containsExactly(SHIP_RULE);
        assertThat(found("출고는 며칠 걸리나요?", null, SHIP_RULE)).containsExactly(SHIP_RULE);
        assertThat(found("배송 기간이 어떻게 되나요?", null, SHIP_RULE)).containsExactly(SHIP_RULE);
        // The 2026-08-30 live miss, verbatim.
        assertThat(found("주문하면 배송은 보통 며칠 정도 걸리나요?", null, SHIP_RULE_2)).containsExactly(SHIP_RULE_2);
    }

    @Test
    @DisplayName("D — 몇 가닥 finds 3가닥: the product name's fragment and its particle leave the denominator, 들어가+나요 meets 들어갑니다")
    void strandsFoundInTheProductScope() {
        assertThat(found("몰딩 안에 몇 가닥 들어가나요?", PRODUCT, STRANDS)).containsExactly(STRANDS);
        // The 2026-08-30 live miss, verbatim (0.33 before: 전선+이 counted 1 char, 들어가나요 counted 0).
        assertThat(found("이 몰딩 안에 전선이 몇 가닥까지 들어가나요?", PRODUCT, STRANDS_2)).containsExactly(STRANDS_2);
        KnowledgeText.Weighing w = KnowledgeText.weigh("이 몰딩 안에 전선이 몇 가닥까지 들어가나요?",
                List.of(KnowledgeText.normalize(STRANDS_2)), PRODUCT);
        assertThat(w.terms()).extracting(KnowledgeText.Term::word).doesNotContain("전선이", "몰딩");
    }

    @Test
    @DisplayName("F — a shipping question never adopts a refund rule through the alias or the shared 일")
    void shippingQuestionDoesNotAdoptTheReturnRule() {
        String returnRule = "단순 변심 반품은 수령 후 7일 이내에만 가능합니다.";
        assertThat(found("배송은 며칠 걸리나요?", null, returnRule)).isEmpty();
        assertThat(found("배송 기간이 어떻게 되나요?", null, returnRule)).isEmpty();
        // Both present: only the shipping rule is offered.
        assertThat(found("배송은 며칠 걸리나요?", null, returnRule, SHIP_RULE)).containsExactly(SHIP_RULE);
        // A refund rule that itself says 반품 배송비 shares the word 배송 — a lexical hit the scorer has always
        // reported; what refuses it is the topic gate the services apply (type · title), pinned in
        // SellerOperationsKnowledgeServiceTest, not a threshold.
        assertThat(KnowledgeTopic.applicable(KnowledgeTopic.of("배송은 며칠 걸리나요?"), KnowledgeTopic.of("교환·반품 처리 기준"))).isFalse();
    }

    @Test
    @DisplayName("F2 — a two-topic question expands no alias: 반품 배송비 is not answered by an 출고 rule")
    void twoTopicQuestionExpandsNothing() {
        assertThat(found("단순 변심 반품이면 반품 배송비는 누가 부담하나요?", null, SHIP_RULE)).isEmpty();
        assertThat(KnowledgeText.weigh("반품 배송비는 누가 부담하나요?", List.of(KnowledgeText.normalize(SHIP_RULE)), "")
                .aliasTopic()).isNull();
    }

    @Test
    @DisplayName("G — a unit alone (mm · 일 · 가닥) admits nothing: 폭이 몇 mm does not adopt 높이 18mm")
    void unitOverlapAloneIsNotEvidence() {
        assertThat(found("폭이 몇 mm인가요?", PRODUCT, HEIGHT)).isEmpty();
        assertThat(found("며칠 걸리나요?", null, RETURN_RULE)).isEmpty();
        // A count noun is a real word: a note stating a 가닥 figure has words for 「몇 가닥」 (product scope
        // already guarantees whose note it is); a note with no figure of that noun does not.
        assertThat(found("몇 가닥 들어가나요?", PRODUCT, "가닥이 굵은 전선은 권장하지 않습니다.")).isEmpty();
        assertThat(QuantityTokens.countedNouns("몰딩 안에 몇 가닥까지 들어가나요?")).containsExactly("가닥");
        assertThat(QuantityTokens.countedNouns("폭이 몇 mm인가요? 며칠 걸리나요?")).isEmpty();
        // …and beside a real word the unit counts: 폭 + mm finds the width note.
        assertThat(found("폭이 몇 mm인가요?", PRODUCT, "내부 폭은 18mm입니다.", HEIGHT)).containsExactly("내부 폭은 18mm입니다.");
        // Several unit-bearing notes: only the one that shares a real word is offered.
        assertThat(found("몰딩 안에 몇 가닥 들어가나요?", PRODUCT, HEIGHT, "무게는 120g입니다.", STRANDS_2, "길이는 2m입니다."))
                .containsExactly(STRANDS_2);
    }

    @Test
    @DisplayName("E — scope safety is the caller's: the same question over another product's corpus finds nothing")
    void anotherProductsCorpusIsAnotherCorpus() {
        assertThat(found("몰딩 안에 몇 가닥 들어가나요?", "케이블타이 2호", "케이블타이는 100개 묶음입니다.")).isEmpty();
    }

    @Test
    @DisplayName("the closed vocabularies: alias only for a vocabulary word, concept only for a unit")
    void closedVocabularies() {
        String ship = KnowledgeText.normalize(SHIP_RULE);
        assertThat(KnowledgeText.aliasMatch("배송은", ship, KnowledgeTopic.SHIPPING)).isEqualTo(2);
        assertThat(KnowledgeText.aliasMatch("배송비는", ship, KnowledgeTopic.SHIPPING)).as("배송비 is not a topic word").isZero();
        assertThat(KnowledgeText.aliasMatch("배송은", ship, null)).isZero();
        assertThat(KnowledgeText.aliasMatch("반품은", ship, KnowledgeTopic.EXCHANGE_RETURN)).isZero();
        assertThat(QuantityTokens.unitOf("며칠")).isEqualTo("일");
        assertThat(QuantityTokens.unitOf("가닥까지")).as("a count noun is a real word, not a unit").isNull();
        assertThat(QuantityTokens.unitOf("mm")).isEqualTo("mm");
        assertThat(QuantityTokens.unitOf("일반")).isNull();
        assertThat(QuantityTokens.unitOf("영업일")).isEqualTo("영업일");
        assertThat(QuantityTokens.statedUnits(KnowledgeText.normalize("2~3일 · 18mm · 3가닥 · 일반"))).containsExactlyInAnyOrder("일", "mm");
        assertThat(KnowledgeText.prefixMatch("들어가나요", KnowledgeText.normalize("들어갑니다"))).isEqualTo(3);
        assertThat(KnowledgeText.prefixMatch("걸리나요", KnowledgeText.normalize("보통 2~3일 걸립니다"))).isEqualTo(2);
        assertThat(KnowledgeText.prefixMatch("되나요", KnowledgeText.normalize("됩니다"))).as("a one-syllable stem never matches through an ending").isZero();
    }
}
