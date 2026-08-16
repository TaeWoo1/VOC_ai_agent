package com.sellerops.review.triage;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The tier rule, over its whole input space.
 *
 * <p>The test that matters most here is {@link #noAmountOfTextCanChangeATier()}. Everything else
 * checks a table; that one checks the BOUNDARY the slice exists to hold —
 * {@code contracts/review-eval/naver/v1/RUBRIC.md} §5 forbids surfacing an unmeasured text detector,
 * and the way that rule gets broken in practice is not by someone adding a detector on purpose. It is
 * by a well-meant "if the body mentions 파손, bump it up", which reads as an improvement and is
 * exactly the gated thing. A rule stated as "content is not an input" is only worth the test that can
 * catch its violation.
 */
class ReviewTriageRulesTest {

    @Test
    void aLowRatingWithSomethingToReadIsTheTopOfTheList() {
        assertThat(ReviewTriageRules.tier(1, "접착력이 약해서 떨어졌어요"))
                .isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(ReviewTriageRules.tier(2, "포장이 찌그러져서 왔어요"))
                .isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
    }

    @Test
    void aLowRatingWithNothingWrittenIsWatchedRatherThanQueued() {
        // RUBRIC §2: "Low rating, no text → NO_ACTION. There is nothing to detect." Not demoted to
        // 참고 either — the rating is real and still counts.
        assertThat(ReviewTriageRules.tier(1, "")).isEqualTo(ReviewTriageTier.WATCH);
        assertThat(ReviewTriageRules.tier(1, "   ")).isEqualTo(ReviewTriageTier.WATCH);
        assertThat(ReviewTriageRules.tier(2, null)).isEqualTo(ReviewTriageTier.WATCH);
    }

    @Test
    void aMiddlingRatingIsWatched() {
        assertThat(ReviewTriageRules.tier(3, "그럭저럭 쓸만합니다")).isEqualTo(ReviewTriageTier.WATCH);
        assertThat(ReviewTriageRules.tier(3, "")).isEqualTo(ReviewTriageTier.WATCH);
    }

    @Test
    void anUnknownRatingIsWatchedBecauseUnknownIsNotGoodNews() {
        assertThat(ReviewTriageRules.tier(null, "본문은 있는데 별점이 없습니다"))
                .isEqualTo(ReviewTriageTier.WATCH);
        assertThat(ReviewTriageRules.tier(null, null)).isEqualTo(ReviewTriageTier.WATCH);
    }

    @Test
    void aGoodRatingCarriesNoAction() {
        assertThat(ReviewTriageRules.tier(4, "만족합니다")).isEqualTo(ReviewTriageTier.FYI);
        assertThat(ReviewTriageRules.tier(5, "")).isEqualTo(ReviewTriageTier.FYI);
    }

    /**
     * Bodies chosen to be the tempting ones: every one of them is a complaint a keyword pass would
     * love to promote, and two are the exact 5★-with-a-complaint case RUBRIC §2 calls
     * {@code NEEDS_LOOK}. v1 does not detect it, does not approximate it, and this pins that the code
     * has not quietly started to.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "배송이 너무 늦었어요",
            "제품이 파손되어 도착했습니다",
            "불량입니다 환불해주세요",
            "예쁜데 택배 기사님이 던지고 갔어요",
            "설치하다가 깨졌어요 최악",
    })
    void noAmountOfTextCanChangeATier(String complaint) {
        for (Integer rating : new Integer[] {null, 1, 2, 3, 4, 5}) {
            assertThat(ReviewTriageRules.tier(rating, complaint))
                    .as("rating %s with a complaint body must tier exactly as any other non-blank body",
                            rating)
                    .isEqualTo(ReviewTriageRules.tier(rating, "본문"));
        }
    }

    @Test
    void theRankIsTheOrderAnOperatorReadsIn() {
        assertThat(List.of(ReviewTriageTier.NEEDS_ATTENTION, ReviewTriageTier.WATCH, ReviewTriageTier.FYI)
                .stream().map(ReviewTriageRules::rank).toList())
                .containsExactly(0, 1, 2);
    }

    @Test
    void everyTierHasARankAndNoTwoShareOne() {
        // Guards the switch against a future value being added with no rank, and against two tiers
        // colliding — either would make the worklist order silently arbitrary rather than fail.
        assertThat(java.util.Arrays.stream(ReviewTriageTier.values()).map(ReviewTriageRules::rank).toList())
                .doesNotHaveDuplicates()
                .hasSize(ReviewTriageTier.values().length);
    }

    @Test
    void blanknessIsOneDefinition() {
        assertThat(ReviewTriageRules.isTextless(null)).isTrue();
        assertThat(ReviewTriageRules.isTextless("")).isTrue();
        assertThat(ReviewTriageRules.isTextless("   ")).isTrue();
        assertThat(ReviewTriageRules.isTextless("ㅎ")).isFalse();
    }

    @Test
    void anUnknownTierFilterIsRefusedRatherThanIgnored() {
        assertThat(ReviewTriageTier.parse("NEEDS_ATTENTION")).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(ReviewTriageTier.parse(" WATCH ")).isEqualTo(ReviewTriageTier.WATCH);
        org.assertj.core.api.Assertions
                .assertThatThrownBy(() -> ReviewTriageTier.parse("URGENT"))
                .hasMessageContaining("알 수 없는");
        org.assertj.core.api.Assertions
                .assertThatThrownBy(() -> ReviewTriageTier.parse(" "))
                .hasMessageContaining("지정해");
    }
}
