package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * The splitter is the structural half of this package's answer to the failure recorded in
 * {@code contracts/review-eval/naver/v1/RUBRIC.md} ("surface-form rigidity rather than vocabulary
 * breadth"), so its behaviour is pinned rather than assumed.
 */
class OpinionUnitSplitterTest {

    @Test
    void blankInputIsNoUnitsRatherThanOneEmptyUnit() {
        assertThat(OpinionUnitSplitter.split(null)).isEmpty();
        assertThat(OpinionUnitSplitter.split("")).isEmpty();
        assertThat(OpinionUnitSplitter.split("   \n  ")).isEmpty();
    }

    @Test
    void aContrastiveClauseBecomesItsOwnUnit() {
        assertThat(OpinionUnitSplitter.split("예쁜데 배송이 너무 늦었어요"))
                .containsExactly("예쁜데", "배송이 너무 늦었어요");
        assertThat(OpinionUnitSplitter.split("품질은 좋지만 가격이 비싸요"))
                .containsExactly("품질은 좋지만", "가격이 비싸요");
    }

    /**
     * The real payoff, and the reason splitting is not cosmetic. Applied to the WHOLE body, the
     * vocabulary pairs the first aspect it sees with the first problem it sees — here 배송 with
     * 난이도, an attribution no sentence in the review makes. Per unit, each clause keeps its own
     * subject.
     */
    @Test
    void splittingPreventsAnAspectFromOneClausePairingWithAProblemFromAnother() {
        String body = "배송은 빨랐는데 설치가 어려웠어요";

        Optional<String> wholeBodyAspect = IssueVocabulary.aspectOf(body);
        Optional<String> wholeBodyProblem = IssueVocabulary.problemOf(body);
        assertThat(wholeBodyAspect).contains("배송");
        assertThat(wholeBodyProblem).contains("난이도");

        List<String> units = OpinionUnitSplitter.split(body);
        assertThat(units).containsExactly("배송은 빨랐는데", "설치가 어려웠어요");
        assertThat(IssueVocabulary.problemOf(units.get(0))).isEmpty();
        assertThat(IssueVocabulary.aspectOf(units.get(1))).contains("설치");
        assertThat(IssueVocabulary.problemOf(units.get(1))).contains("난이도");
    }

    @Test
    void sentenceTerminatorsSplitAndStayWithTheirOwnUnit() {
        assertThat(OpinionUnitSplitter.split("배송이 늦었어요. 그래도 잘 받았습니다!"))
                .containsExactly("배송이 늦었어요.", "그래도 잘 받았습니다!");
    }

    @Test
    void newlinesSplitAndCarriageReturnsDoNotLeakIntoUnits() {
        assertThat(OpinionUnitSplitter.split("색상이 달라요\r\n포장은 괜찮았어요"))
                .containsExactly("색상이 달라요", "포장은 괜찮았어요");
    }

    @Test
    void contrastiveOpenersSplitBeforeThemselves() {
        assertThat(OpinionUnitSplitter.split("잘 받았습니다 그러나 색상이 달라요"))
                .containsExactly("잘 받았습니다", "그러나 색상이 달라요");
    }

    /**
     * 그런데 / 근데 / 하지만 need no opener rule of their own: they end in 데 or 지만, so the
     * contrastive-ending rules already split after them and the connective trails the previous unit.
     * That placement is harmless — an opener carries no vocabulary keyword — and what matters is that
     * the clause carrying the complaint is a unit of its own.
     */
    @Test
    void selfSplittingOpenersTrailThePreviousUnitAndDoNotSplitTwice() {
        assertThat(OpinionUnitSplitter.split("잘 받았습니다 그런데 색상이 달라요"))
                .containsExactly("잘 받았습니다 그런데", "색상이 달라요");
        assertThat(OpinionUnitSplitter.split("포장은 좋아요 하지만 설치가 어려워요"))
                .containsExactly("포장은 좋아요 하지만", "설치가 어려워요");
    }

    /**
     * The two guards that keep the 데/지만 rules from firing inside words. Without the adjacency
     * requirement the free noun 데 would split; without the trailing-whitespace requirement 인데
     * inside a noun would.
     */
    @Test
    void connectiveLookalikesInsideWordsDoNotSplit() {
        assertThat(OpinionUnitSplitter.split("확인데이터가 정확합니다")).containsExactly("확인데이터가 정확합니다");
        assertThat(OpinionUnitSplitter.split("생각한 데 비해 좋아요")).containsExactly("생각한 데 비해 좋아요");
    }

    @Test
    void fragmentsTooShortToCarryAKeywordAreNotUnits() {
        // The "." and the single-char pieces are dropped; only real clauses remain.
        assertThat(OpinionUnitSplitter.split("좋아요. . 배송 늦었어요"))
                .containsExactly("좋아요.", "배송 늦었어요");
    }

    @Test
    void splittingIsStableSoStoredUnitOrdinalsKeepMeaning() {
        String body = "배송은 빨랐는데 설치가 어려웠어요. 색상도 달라요";
        assertThat(OpinionUnitSplitter.split(body)).isEqualTo(OpinionUnitSplitter.split(body));
    }

    @Test
    void noUnitEverContainsTheInternalSplitMarker() {
        for (String unit : OpinionUnitSplitter.split("배송이 늦었는데 색상도 달라요. 설치는 쉬웠어요")) {
            assertThat(unit).doesNotContain("\u0000");
        }
    }
}
