package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Retrieval &amp; Grounding Correctness v1 — the bounded candidates one question is asked as.
 *
 * <p>The rule under test is not a scorer change: every candidate meets the unchanged gates. What is
 * pinned is that a planner's sentence and a customer's thread yield a SUBJECT form that says what the
 * two words that matter say, and nothing the reader was addressed with.
 */
class RetrievalQueryTest {

    @Test
    @DisplayName("a planner's instruction sentence reduces to its subject; the instruction words are gone")
    void plannerSentenceReducesToItsSubject() {
        String subject = RetrievalQuery.subjectOf("이 상품의 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘");
        assertThat(subject).contains("교환").contains("반품").contains("조건");
        assertThat(subject).doesNotContain("확인").doesNotContain("명시").doesNotContain("가능").doesNotContain("있는지");
        // The planner also writes the inflected form (live 2026-08-30): an inflection of a stop word is a stop word.
        String inflected = RetrievalQuery.subjectOf("이 상품의 반품 조건이 명시되어 있는지 확인");
        assertThat(inflected).contains("반품").contains("조건").doesNotContain("명시되어");
    }

    static final String[] PLANNER_SENTENCES = PlannerSentences.ABOUT_THE_RETURN_DOCUMENT;

    @Test
    @DisplayName("candidate agreement: the seller's noun, the seller's sentence and the planner's three sentences share one SUBJECT")
    void candidateAgreement() {
        String[] inputs = {"반품 조건", "이 상품의 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘",
                PLANNER_SENTENCES[0], PLANNER_SENTENCES[1], PLANNER_SENTENCES[2]};
        for (String in : inputs) {
            String subject = RetrievalQuery.subjectOf(in);
            assertThat(subject).as(in).contains("반품").contains("조건");
            // Nothing the planner addressed to us, and nothing that names the artefact, is a topic word.
            for (String meta : new String[] {"문서", "설명", "faq", "정책", "판매자", "작성", "상품의", "문장", "안내문",
                    "핵심", "내용", "명시", "확인", "있는", "가능", "대해", "해당"}) {
                assertThat(subject).as(in + " keeps " + meta).doesNotContain(meta);
            }
        }
        // The seller's own what-did-we-say sentence reduces to the same subject (live 2026-08-30: the memory lane
        // missed 「QA 전선몰딩 문의에 반품 조건 예전에 뭐라고 답했어?」 on 문의에·뭐라고·답했어 counted as topic).
        assertThat(RetrievalQuery.subjectOf("QA 전선몰딩 문의에 반품 조건 예전에 뭐라고 답했어?")).isEqualTo("qa 전선몰딩 반품 조건");
        // D: a question about another topic is not touched — its own words are its subject.
        assertThat(RetrievalQuery.subjectOf("배송 기간")).isEqualTo("배송 기간");
    }

    @Test
    @DisplayName("a structured topic is the first candidate and part of the text the topic gate classifies")
    void structuredTopicFirst() {
        RetrievalQuery q = RetrievalQuery.of("교환 반품 환불", null, PLANNER_SENTENCES[0]);
        assertThat(q.candidates().get(0).origin()).isEqualTo(RetrievalQuery.Origin.TOPIC);
        assertThat(q.candidates().get(0).text()).isEqualTo("교환 반품 환불");
        assertThat(q.text()).startsWith("교환 반품 환불 ");
        assertThat(q.full()).isEqualTo(PLANNER_SENTENCES[0]);
        assertThat(q.candidates()).hasSizeLessThanOrEqualTo(RetrievalQuery.MAX_CANDIDATES);
    }

    @Test
    @DisplayName("candidates: topic → title → subject → full, deduped, never more than four")
    void candidatesInOrder() {
        RetrievalQuery q = RetrievalQuery.of("배송", "배송 문의",
                "안녕하세요 배송은 보통 며칠 걸리나요? 급해서 문의드립니다.");
        List<RetrievalQuery.Origin> origins = q.candidates().stream().map(RetrievalQuery.Candidate::origin).toList();
        assertThat(origins).containsExactly(RetrievalQuery.Origin.TOPIC, RetrievalQuery.Origin.TITLE,
                RetrievalQuery.Origin.SUBJECT, RetrievalQuery.Origin.FULL);
        assertThat(q.candidates()).hasSizeLessThanOrEqualTo(RetrievalQuery.MAX_CANDIDATES);
        assertThat(q.full()).startsWith("배송 문의 안녕하세요");
    }

    @Test
    @DisplayName("a short question that IS its own subject collapses to one candidate — no duplicate searches")
    void shortQuestionCollapses() {
        RetrievalQuery q = RetrievalQuery.ofText("반품 조건");
        assertThat(q.candidates()).hasSize(1);
        assertThat(q.candidates().get(0).text()).isEqualTo("반품 조건");
    }

    @Test
    @DisplayName("the FULL candidate is bounded to the head of a long thread")
    void fullIsBounded() {
        String thread = "배송 문의 " + "이전 메일 내용입니다. ".repeat(100);
        RetrievalQuery q = RetrievalQuery.of(null, "배송 문의", thread);
        assertThat(q.full().length()).isLessThanOrEqualTo(RetrievalQuery.FULL_CHARS);
    }

    @Test
    @DisplayName("blank input yields no candidates rather than an empty query")
    void blankYieldsNothing() {
        assertThat(RetrievalQuery.of(null, null, "  ").candidates()).isEmpty();
    }
}
