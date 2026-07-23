package com.sellerops.review;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.community.CommunityReplyStatus;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The channel-reply-state vocabulary and the monotonic rule.
 *
 * <p>Two properties carry weight beyond the mapping itself: nothing unrecognized may ever normalize
 * to ANSWERED (that would hide real work), and an import may never un-answer a review (that would
 * re-arm duplicate public replies on a stale re-upload).
 */
class ReviewReplyStateTest {

    @ParameterizedTest
    @ValueSource(strings = {"Y", "y", " Y ", "YES", "answered"})
    void answeredTokensNormalizeToAnswered(String raw) {
        assertThat(ReviewReplyState.normalize(raw)).isEqualTo(ReviewReplyState.ANSWERED);
    }

    @ParameterizedTest
    @ValueSource(strings = {"N", "n", " N ", "NO", "pending"})
    void pendingTokensNormalizeToPending(String raw) {
        assertThat(ReviewReplyState.normalize(raw)).isEqualTo(ReviewReplyState.PENDING);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "?", "C", "P", "처리중", "true", "1", "답변", "답변완료", "미답변"})
    void anythingElseIsUnknownAndNeverGuessedAsAnswered(String raw) {
        // "C"/"P" are Cafe24 INQUIRY tokens, and 답변완료/미답변 are Korean prose no observed export
        // uses. Both are deliberately NOT recognized: accepting an unobserved vocabulary is a
        // channel-support decision made in a switch statement, and 답변완료 → ANSWERED would be the
        // guess that silently drops a review out of the operator's queue.
        assertThat(ReviewReplyState.normalize(raw)).isEqualTo(ReviewReplyState.UNKNOWN);
    }

    @Test
    void nullIsUnknown() {
        assertThat(ReviewReplyState.normalize(null)).isEqualTo(ReviewReplyState.UNKNOWN);
    }

    @Test
    void theVocabularyIsASubsetOfTheCafe24OneSoBothLandOnTheSameChip() {
        // The frontend renders ONE chip map keyed by these names. Two sources with drifting
        // vocabularies would render one of them as 상태 미상 for a state it actually knows.
        Set<String> review = Arrays.stream(ReviewReplyState.values()).map(Enum::name).collect(Collectors.toSet());
        Set<String> community = Arrays.stream(CommunityReplyStatus.values()).map(Enum::name).collect(Collectors.toSet());

        assertThat(community).containsAll(review);
        // …and the one value a review can never have is absent, rather than present-but-unused.
        assertThat(review).doesNotContain("IN_PROGRESS");
    }

    // --- the monotonic rule -----------------------------------------------------------

    @Test
    void anImportMayReportAReviewAsAnswered() {
        assertThat(ReviewReplyState.isProgress(ReviewReplyState.UNKNOWN, ReviewReplyState.ANSWERED)).isTrue();
        assertThat(ReviewReplyState.isProgress(ReviewReplyState.PENDING, ReviewReplyState.ANSWERED)).isTrue();
    }

    @Test
    void anImportMayResolveAnUnknownIntoPending() {
        assertThat(ReviewReplyState.isProgress(ReviewReplyState.UNKNOWN, ReviewReplyState.PENDING)).isTrue();
    }

    @Test
    void anImportMayNEVERUnAnswerAReview() {
        // THE RULE THIS EXISTS FOR. A stale re-upload — last month's export imported after this
        // month's — would otherwise mark every review answered since as unanswered again,
        // re-inflating the queue and re-arming the guided flow against reviews that already have a
        // public reply. The opposite failure (a genuinely deleted reply staying marked answered)
        // costs one missed prompt, which stays visible on the surface.
        assertThat(ReviewReplyState.isProgress(ReviewReplyState.ANSWERED, ReviewReplyState.PENDING)).isFalse();
        assertThat(ReviewReplyState.isProgress(ReviewReplyState.ANSWERED, ReviewReplyState.UNKNOWN)).isFalse();
    }

    @Test
    void anUnknownImportTeachesNothingAndNeverOverwrites() {
        // A source that says nothing must not erase a state a source that spoke had established.
        assertThat(ReviewReplyState.isProgress(ReviewReplyState.PENDING, ReviewReplyState.UNKNOWN)).isFalse();
        assertThat(ReviewReplyState.isProgress(ReviewReplyState.UNKNOWN, ReviewReplyState.UNKNOWN)).isFalse();
    }

    @Test
    void anIdenticalRestatementIsNotProgress() {
        for (ReviewReplyState s : ReviewReplyState.values()) {
            assertThat(ReviewReplyState.isProgress(s, s)).as("%s → %s", s, s).isFalse();
        }
    }
}
