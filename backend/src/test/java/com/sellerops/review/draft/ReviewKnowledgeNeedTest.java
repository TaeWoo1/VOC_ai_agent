package com.sellerops.review.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.knowledge.QuestionShape;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 「근거를 못 찾았다」 and 「기준이 필요하다」 are different questions.
 *
 * <p>The case this exists for is the one Grounded Review Drafting v1 shipped wrong: a ★5 「좋아요 아주
 * 만족합니다」 produced 「'좋아요 아주 만족합니다'에 대해 고객에게 안내하는 공식 기준이 있나요?」, which reads
 * as «your library is deficient because a customer was happy».
 *
 * <p><b>Rewritten by Knowledge Retrieval Quality v1 §9, and one guarantee is deliberately reversed.</b>
 * The predicate used to ask whenever the product's library was EMPTY, whatever the review said,
 * described as onboarding. Measured against the criterion the question is supposed to answer — «does
 * answering this review need facts only this seller has» — an empty library is a fact about us, and
 * the reversal is recorded here rather than in a diff nobody reads.
 */
class ReviewKnowledgeNeedTest {

    private static ReviewKnowledgeNeed need(Integer rating, boolean issue, boolean asks) {
        return ReviewKnowledgeNeed.of(false, true, rating,
                issue, asks);
    }

    @Test
    @DisplayName("a compliment asks for nothing")
    void praiseAsksForNothing() {
        assertThat(need(5, false, false)).isEqualTo(ReviewKnowledgeNeed.NO_EVIDENCE);
        assertThat(need(4, false, false)).isEqualTo(ReviewKnowledgeNeed.NO_EVIDENCE);
    }

    @Test
    @DisplayName("a low-rated review asks — an answer was owed")
    void aComplaintAsks() {
        assertThat(need(2, false, false)).isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
        assertThat(need(3, false, false)).isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
    }

    @Test
    @DisplayName("a review recorded as evidence for a repeated problem asks whatever its rating")
    void aRepeatedProblemAsks() {
        assertThat(need(5, true, false)).isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
    }

    @Test
    @DisplayName("a five-star review that ASKS something asks — the rating points the wrong way")
    void aQuestionAsksWhateverTheStarsSay() {
        assertThat(need(5, false, true)).isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
        // The shape that decides it, on the sentences it decides between.
        assertThat(QuestionShape.asks("물에 닿아도 써도 되나요?")).isTrue();
        assertThat(QuestionShape.asks("배송 며칠 걸리나요")).isTrue();
        assertThat(QuestionShape.asks("색상이 몇 가지예요")).isTrue();
        assertThat(QuestionShape.asks("너무 좋아요 만족합니다")).isFalse();
        assertThat(QuestionShape.asks("재구매 의사 있어요")).isFalse();
        assertThat(QuestionShape.asks("잘 쓰고 있습니다 감사합니다")).isFalse();
        assertThat(QuestionShape.asks("")).isFalse();
        assertThat(QuestionShape.asks(null)).isFalse();
    }

    @Test
    @DisplayName("an empty library is not a reason to ask about a compliment")
    void anEmptyLibraryIsNotAReasonOnItsOwn() {
        // Pilot QA (2026-09-06). This used to return KNOWLEDGE_NEEDED, and on the live org that put
        // 「항상 만족하며 잘 사용하고있어요」 — a ★5 compliment — into 확인 필요 as a missing standard.
        // The clause was defended as protecting ★4 「괜찮긴한데 잘떨어지네요」; the live rows say it never
        // reached that review (its product has ten registered documents, so the outcome is not
        // ABSENT), while it did reach 2,747 ★4+ reviews on knowledge-less products.
        assertThat(ReviewKnowledgeNeed.of(false, true, 5, false, false))
                .isEqualTo(ReviewKnowledgeNeed.NO_EVIDENCE);
    }

    @Test
    @DisplayName("an empty library still asks when the review itself says an answer was owed")
    void anEmptyLibraryStillAsksForAnOwedReview() {
        // The three signals are unchanged, and each one alone is enough — so onboarding is not lost
        // where it matters: the first complaint, question or recorded issue on a bare product asks.
        assertThat(ReviewKnowledgeNeed.of(false, true, 2, false, false))
                .isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
        assertThat(ReviewKnowledgeNeed.of(false, true, 5, true, false))
                .isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
        assertThat(ReviewKnowledgeNeed.of(false, true, 5, false, true))
                .isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
    }

    @Test
    @DisplayName("no product means no form to open — the fix is a binding, not a standard")
    void noProductAsksForNothing() {
        assertThat(ReviewKnowledgeNeed.of(false, false, 1, true, true))
                .isEqualTo(ReviewKnowledgeNeed.NO_EVIDENCE);
    }

    @Test
    @DisplayName("grounded is grounded — nothing is missing and nothing is asked")
    void groundedAsksForNothing() {
        assertThat(ReviewKnowledgeNeed.of(true, true, 1, true, true))
                .isEqualTo(ReviewKnowledgeNeed.GROUNDED);
        assertThat(ReviewKnowledgeNeed.GROUNDED.asks()).isFalse();
        assertThat(ReviewKnowledgeNeed.NO_EVIDENCE.asks()).isFalse();
        assertThat(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED.asks()).isTrue();
    }
}
