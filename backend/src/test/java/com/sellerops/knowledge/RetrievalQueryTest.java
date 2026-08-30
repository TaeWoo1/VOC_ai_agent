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
