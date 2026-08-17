package com.sellerops.review.triage.llm;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * RUBRIC v2 §6.3 condition 4, made impossible rather than requested.
 *
 * <p>Exhaustive over the whole input space, not sampled: four baselines (three tiers plus the
 * null a failed classification produces) × four candidate values = sixteen cases, every one of them
 * asserted. A property this cheap to enumerate should not be spot-checked, and the one case that
 * matters — baseline {@code NEEDS_ATTENTION}, candidate anything — is the case a future edit would
 * break while every hand-picked example still passed.
 */
class AdditiveTriageDecisionTest {

    private static final List<ReviewTriageTier> TIERS =
            Arrays.asList(ReviewTriageTier.NEEDS_ATTENTION, ReviewTriageTier.WATCH,
                    ReviewTriageTier.FYI, null);

    @Test
    @DisplayName("a baseline 확인 필요 survives every answer a model can give — exhaustively")
    void nothingCanDemoteTheBaseline() {
        List<String> demotions = new ArrayList<>();
        for (ReviewTriageTier candidate : TIERS) {
            ReviewTriageTier decided =
                    AdditiveTriageDecision.decide(ReviewTriageTier.NEEDS_ATTENTION, candidate);
            if (decided != ReviewTriageTier.NEEDS_ATTENTION) {
                demotions.add("candidate " + candidate + " → " + decided);
            }
        }
        assertThat(demotions).as("a detector may only ADD (v1 §5)").isEmpty();
    }

    @Test
    @DisplayName("a model may promote NO_ACTION to 확인 필요")
    void promotionIsAllowed() {
        assertThat(AdditiveTriageDecision.decide(ReviewTriageTier.WATCH, ReviewTriageTier.NEEDS_ATTENTION))
                .isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(AdditiveTriageDecision.decide(ReviewTriageTier.FYI, ReviewTriageTier.NEEDS_ATTENTION))
                .isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
    }

    @Test
    @DisplayName("the whole 4×4 table, stated rather than inferred")
    void everyCase() {
        for (ReviewTriageTier baseline : TIERS) {
            for (ReviewTriageTier candidate : TIERS) {
                ReviewTriageTier decided = AdditiveTriageDecision.decide(baseline, candidate);
                if (baseline == ReviewTriageTier.NEEDS_ATTENTION) {
                    assertThat(decided).as("%s / %s", baseline, candidate)
                            .isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
                } else if (candidate == null) {
                    // A failed classification degrades to the rule — which is what the product shows
                    // today — and never to FYI (§8.5).
                    assertThat(decided).as("%s / failed", baseline).isEqualTo(baseline);
                } else {
                    assertThat(decided).as("%s / %s", baseline, candidate).isEqualTo(candidate);
                }
            }
        }
    }

    @Test
    @DisplayName("the two reviews the first candidate demoted cannot be demoted now")
    void theTwoRealDemotionsAreClosed() {
        // Run 2 of the gpt-5 alias candidate demoted a 2★ and a 1★, both with text, both of which
        // the humans also called 확인 필요. Shapes reproduced here — no corpus text, which the
        // rule does not read anyway.
        for (int rating : new int[] {1, 2}) {
            assertThat(ReviewTriageRules.tier(rating, "본문 있음"))
                    .as("the baseline the model demoted").isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
            assertThat(AdditiveTriageDecision.decide(rating, "본문 있음", ReviewTriageTier.WATCH))
                    .as("%d★ with text, model says WATCH", rating)
                    .isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        }
    }

    @Test
    @DisplayName("WATCH → FYI stays open, and that is deliberate")
    void theNoActionSplitIsNotFrozen() {
        // Both are NO_ACTION in the partition every gate scores (§2), and §2 calls a WATCH/FYI
        // confusion a product-quality finding rather than a go/no-go one. Freezing this direction
        // would pin the model to the rule's 3★ handling — one of the things it is here to improve.
        assertThat(AdditiveTriageDecision.decide(ReviewTriageTier.WATCH, ReviewTriageTier.FYI))
                .isEqualTo(ReviewTriageTier.FYI);
    }

    @Test
    @DisplayName("an outage lands on the rule, never on FYI")
    void failureDegradesToTheRule() {
        assertThat(AdditiveTriageDecision.decide(2, "본문 있음", null))
                .isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(AdditiveTriageDecision.decide(3, "본문", null)).isEqualTo(ReviewTriageTier.WATCH);
        assertThat(AdditiveTriageDecision.decide(5, "좋아요", null)).isEqualTo(ReviewTriageTier.FYI);
    }
}
