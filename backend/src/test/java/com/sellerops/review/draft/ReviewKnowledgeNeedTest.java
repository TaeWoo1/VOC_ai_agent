package com.sellerops.review.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.knowledge.RetrievalOutcome;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Knowledge Sources &amp; Acquisition v1 §E — 「근거를 못 찾았다」 and 「기준이 필요하다」 are different.
 *
 * <p>The case this exists for is the one the previous package shipped wrong: a ★5 「좋아요 아주
 * 만족합니다」 produced 「'좋아요 아주 만족합니다'에 대해 고객에게 안내하는 공식 기준이 있나요?」, which reads
 * as «your library is deficient because a customer was happy».
 */
class ReviewKnowledgeNeedTest {

    private static ReviewKnowledgeNeed need(RetrievalOutcome outcome, Integer rating, boolean issue) {
        return ReviewKnowledgeNeed.of(false, true, outcome, rating, issue);
    }

    @Test
    @DisplayName("a compliment against a stocked library asks for nothing")
    void praiseAsksForNothing() {
        assertThat(need(RetrievalOutcome.NO_RELEVANT_EVIDENCE, 5, false))
                .isEqualTo(ReviewKnowledgeNeed.NO_EVIDENCE);
        assertThat(need(RetrievalOutcome.NO_RELEVANT_EVIDENCE, 4, false))
                .isEqualTo(ReviewKnowledgeNeed.NO_EVIDENCE);
    }

    @Test
    @DisplayName("a low-rated review against a stocked library asks — an answer was owed")
    void aComplaintAsks() {
        assertThat(need(RetrievalOutcome.NO_RELEVANT_EVIDENCE, 2, false))
                .isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
        assertThat(need(RetrievalOutcome.NO_RELEVANT_EVIDENCE, 3, false))
                .isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
    }

    @Test
    @DisplayName("a review recorded as evidence for a repeated problem asks whatever its rating")
    void aRepeatedProblemAsks() {
        assertThat(need(RetrievalOutcome.NO_RELEVANT_EVIDENCE, 5, true))
                .isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
    }

    @Test
    @DisplayName("an empty library is worth saying once, whatever the review says")
    void anEmptyLibraryIsWorthSayingOnce() {
        assertThat(need(RetrievalOutcome.ABSENT, 5, false)).isEqualTo(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED);
    }

    @Test
    @DisplayName("no product means no form to open — the fix is a binding, not a standard")
    void noProductAsksForNothing() {
        assertThat(ReviewKnowledgeNeed.of(false, false, RetrievalOutcome.ABSENT, 1, true))
                .isEqualTo(ReviewKnowledgeNeed.NO_EVIDENCE);
    }

    @Test
    @DisplayName("grounded is grounded — nothing is missing and nothing is asked")
    void groundedAsksForNothing() {
        assertThat(ReviewKnowledgeNeed.of(true, true, RetrievalOutcome.FOUND, 1, true))
                .isEqualTo(ReviewKnowledgeNeed.GROUNDED);
        assertThat(ReviewKnowledgeNeed.GROUNDED.asks()).isFalse();
        assertThat(ReviewKnowledgeNeed.NO_EVIDENCE.asks()).isFalse();
        assertThat(ReviewKnowledgeNeed.KNOWLEDGE_NEEDED.asks()).isTrue();
    }
}
