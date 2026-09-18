package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.review.ReviewReplyState;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>A rating alone never closes a review someone wrote words in</b> (Customer Ops Product Quality Closure v1).
 *
 * <p>The 218-review labelled corpus measured 18 false auto-closes, every one a 4–5★ review with text. The contract
 * pinned here: only a high rating with nothing to read, or a review already answered, is closed by a rule; the issue
 * extractor may lift a worded review into an investigation, and it can never move one toward closing.
 */
class OperationsCaseReviewRulesTest {

    private static OperationsCaseRules.Conclusion rule(Integer rating, String body) {
        return OperationsCaseRules.forReview(rating, body, ReviewReplyState.UNKNOWN);
    }

    @Test
    @DisplayName("only a high rating with nothing to read is auto-closed by a rule")
    void onlyTheTextlessHighRatingCloses() {
        assertThat(rule(5, "").disposition()).isEqualTo(CaseDisposition.AUTO_RESOLVED);
        assertThat(rule(4, "   ").disposition()).isEqualTo(CaseDisposition.AUTO_RESOLVED);
        assertThat(rule(5, "잘 받았습니다. 튼튼해요.").disposition()).isEqualTo(CaseDisposition.MONITORING);
        assertThat(rule(5, "잘 받았습니다. 튼튼해요.").reason()).isEqualTo(CaseReason.REVIEW_HIGH_RATING_WITH_TEXT);
    }

    @Test
    @DisplayName("a high rating that asserts a problem is investigated; a negated one is watched, never closed")
    void theExtractorOnlyAddsALook() {
        OperationsCaseRules.Conclusion broke = rule(5, "배송은 빨랐는데 한쪽이 금방 떨어졌어요.");
        assertThat(broke.needsInvestigation()).isTrue();
        assertThat(broke.reason()).isEqualTo(CaseReason.REVIEW_HIGH_RATING_PROBLEM);

        OperationsCaseRules.Conclusion negated = rule(5, "파손없이 잘 도착했네요.");
        assertThat(negated.needsInvestigation()).isFalse();
        assertThat(negated.disposition()).isEqualTo(CaseDisposition.MONITORING);
    }

    @Test
    @DisplayName("a 3★ review that asserts a problem is investigated; the rest of the tiers are unchanged")
    void theOtherTiers() {
        assertThat(rule(3, "한쪽이 금방 떨어졌어요.").reason()).isEqualTo(CaseReason.REVIEW_WATCH_PROBLEM);
        assertThat(rule(3, "그냥 그래요.").disposition()).isEqualTo(CaseDisposition.MONITORING);
        assertThat(rule(1, "").disposition()).isEqualTo(CaseDisposition.MONITORING);
        assertThat(rule(1, "별로예요").needsInvestigation()).isTrue();
        assertThat(rule(null, "좋아요").disposition()).isEqualTo(CaseDisposition.MONITORING);
        assertThat(OperationsCaseRules.forReview(5, "떨어졌어요", ReviewReplyState.ANSWERED).disposition())
                .isEqualTo(CaseDisposition.AUTO_RESOLVED);
    }

    @Test
    @DisplayName("a textless 4–5★ closes under its own code; the old code keeps its old meaning for the cases it names")
    void aStoredCodeKeepsItsMeaning() {
        assertThat(rule(5, null).reason()).isEqualTo(CaseReason.REVIEW_TEXTLESS_HIGH_RATING);
        assertThat(CaseReason.REVIEW_TEXTLESS_HIGH_RATING.noteKo()).contains("글 없이");
        // Cases written before the rule was narrowed closed worded reviews under REVIEW_ROUTINE; the sentence they
        // show must not claim the review had no text.
        assertThat(CaseReason.REVIEW_ROUTINE.noteKo()).doesNotContain("글 없이");
        assertThat(CaseReason.REVIEW_ROUTINE.factKo()).doesNotContain("글 없이");
        for (int rating = 1; rating <= 5; rating++) {
            for (String body : new String[] {null, "", "빠른배송 굿굿입니다", "한쪽이 떨어졌어요"}) {
                assertThat(OperationsCaseRules.forReview(rating, body, ReviewReplyState.UNKNOWN).reason())
                        .isNotEqualTo(CaseReason.REVIEW_ROUTINE);
            }
        }
    }
}
