package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Retrieval Query Selection v1 — the two closed classes a planner writes and a customer's nouns.
 *
 * <p>The rule is stem + closed grammar, so an inflection never needs its own entry; and because the
 * grammar is closed, a noun that merely begins like an instruction (확인서) is still a noun.
 */
class QueryTokensTest {

    @Test
    @DisplayName("an instruction in any inflection is an instruction — one stem, no per-form entries")
    void instructionsInAnyInflection() {
        for (String w : new String[] {"확인", "확인해줘", "확인해주세요", "확인한다", "확인할", "확인하고", "명시", "명시돼",
                "명시된", "명시되어", "명시돼있는지", "명시되어있는가", "적혀있나요", "적힌", "나와있는지", "기재돼", "찾아봐줘",
                "찾는", "알려주세요", "알아봐", "있는가", "있나요", "있음", "없는지", "가능", "가능한", "가능한지", "여부",
                "필요한", "포함돼", "되나요", "되는지", "보여줘", "보낸", "보냈는지", "답했어", "답했는지", "했었는지"}) {
            assertThat(QueryTokens.classify(w)).as(w).isEqualTo(QueryTokens.Kind.INSTRUCTION);
        }
    }

    @Test
    @DisplayName("the nouns for the artefact, the party and the relation are META, with or without their particle")
    void metaNounsWithParticles() {
        for (String w : new String[] {"문서", "문서의", "문장이", "문구의", "설명", "설명문", "안내문에", "faq", "가이드", "정책",
                "규정", "기준", "내용을", "정보에서", "자료", "근거", "핵심", "판매자가", "작성한", "등록된", "관련된", "해당하는",
                "상품의", "제품은", "회사의", "고객", "답변", "답변했는지", "대해", "관한", "예전에", "과거", "뭐라고", "문의에",
                "리뷰", "사례", "참고"}) {
            assertThat(QueryTokens.classify(w)).as(w).isEqualTo(QueryTokens.Kind.META);
        }
    }

    @Test
    @DisplayName("a topic word that happens to start like a stem or a meta noun is still a topic word")
    void nounsAreNotEatenByPrefix() {
        for (String w : new String[] {"확인서", "설명서", "반품", "조건", "조건이", "배송", "기간", "가능성", "필요성",
                "내용물", "상품권", "고객센터", "안내장", "정보통신", "되돌리기", "교환이나", "환불", "상태", "요건", "비용", "부담"}) {
            assertThat(QueryTokens.classify(w)).as(w).isEqualTo(QueryTokens.Kind.TOPIC);
        }
        assertThat(QueryTokens.isTopicBearing("중")).isFalse();
        assertThat(QueryTokens.isTopicBearing("반품")).isTrue();
    }

    @Test
    @DisplayName("grammar is a closed chain of endings — 돼+있는지 is grammar, a noun-forming 서 is not")
    void grammarIsClosed() {
        assertThat(QueryTokens.isGrammar("")).isTrue();
        assertThat(QueryTokens.isGrammar("돼있는지")).isTrue();
        assertThat(QueryTokens.isGrammar("해주세요")).isTrue();
        assertThat(QueryTokens.isGrammar("했는지")).isTrue();
        assertThat(QueryTokens.isGrammar("의")).isTrue();
        assertThat(QueryTokens.isGrammar("서")).isFalse();
        assertThat(QueryTokens.isGrammar("성")).isFalse();
        assertThat(QueryTokens.isGrammar("센터")).isFalse();
    }
}
