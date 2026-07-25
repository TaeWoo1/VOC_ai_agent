package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * Every judgement at its exact threshold boundary.
 *
 * <p>The numbers are asserted as literals on purpose. They were fixed in
 * {@code contracts/review-issue/v1/THRESHOLDS.md} before this code could produce a verdict, for the
 * same reason {@code review-eval/naver/v1/RUBRIC.md} predates any detector: a threshold that can
 * drift silently to match a result is not a threshold. If one of these literals has to change, the
 * contract changes with it.
 */
class IssueChangeRulesTest {

    /** A snapshot with nothing firing, to be adjusted per test. */
    private static Builder quiet() {
        return new Builder();
    }

    private static final class Builder {
        private long newWindowCount;
        private boolean hadEvidenceBefore = true;
        private long surgeWindowCount;
        private long surgeBaselineTotal;
        private int activeWeeks;
        private long concentrationTotal;
        private long concentrationTop;
        private long improveCurrent;
        private long improveBaseline;

        Builder newWindow(long count, boolean hadBefore) {
            this.newWindowCount = count;
            this.hadEvidenceBefore = hadBefore;
            return this;
        }

        Builder surge(long current, long baselineTotal) {
            this.surgeWindowCount = current;
            this.surgeBaselineTotal = baselineTotal;
            return this;
        }

        Builder activeWeeks(int weeks) {
            this.activeWeeks = weeks;
            return this;
        }

        Builder concentration(long total, long top) {
            this.concentrationTotal = total;
            this.concentrationTop = top;
            return this;
        }

        Builder improvement(long current, long baseline) {
            this.improveCurrent = current;
            this.improveBaseline = baseline;
            return this;
        }

        IssueWindowSnapshot build() {
            return new IssueWindowSnapshot(newWindowCount, hadEvidenceBefore, surgeWindowCount,
                    surgeBaselineTotal, activeWeeks, concentrationTotal, concentrationTop,
                    improveCurrent, improveBaseline);
        }

        IssueChangeRules.Assessment assess() {
            return IssueChangeRules.assess(build());
        }
    }

    @Test
    void theThresholdsAreTheOnesTheContractCommittedTo() {
        assertThat(ReviewIssueThresholds.NEW_WINDOW_DAYS).isEqualTo(14);
        assertThat(ReviewIssueThresholds.NEW_MIN_EVIDENCE).isEqualTo(3);
        assertThat(ReviewIssueThresholds.SURGE_WINDOW_DAYS).isEqualTo(7);
        assertThat(ReviewIssueThresholds.SURGE_BASELINE_WEEKS).isEqualTo(8);
        assertThat(ReviewIssueThresholds.SURGE_MIN_CURRENT).isEqualTo(4);
        assertThat(ReviewIssueThresholds.SURGE_MIN_BASELINE_TOTAL).isEqualTo(4);
        assertThat(ReviewIssueThresholds.SURGE_RATIO).isEqualTo(2.0);
        assertThat(ReviewIssueThresholds.PERSIST_LOOKBACK_WEEKS).isEqualTo(6);
        assertThat(ReviewIssueThresholds.PERSIST_MIN_ACTIVE_WEEKS).isEqualTo(4);
        assertThat(ReviewIssueThresholds.CONCENTRATION_WINDOW_DAYS).isEqualTo(28);
        assertThat(ReviewIssueThresholds.CONCENTRATION_MIN_TOTAL).isEqualTo(5);
        assertThat(ReviewIssueThresholds.CONCENTRATION_SHARE).isEqualTo(0.60);
        assertThat(ReviewIssueThresholds.IMPROVE_MIN_BASELINE_WEEKLY).isEqualTo(2.0);
        assertThat(ReviewIssueThresholds.IMPROVE_MAX_RATIO).isEqualTo(0.40);
        assertThat(ReviewIssueThresholds.RESOLVE_QUIET_WEEKS).isEqualTo(4);
    }

    @Test
    void nothingFiresOnAnEmptyIssue() {
        assertThat(quiet().assess().kinds()).isEmpty();
    }

    // ---- 신규 등장 ---------------------------------------------------------------------------

    @Test
    void threePiecesOfEvidenceAndNoHistoryIsNew() {
        assertThat(quiet().newWindow(3, false).assess().has(IssueChangeKind.NEW)).isTrue();
    }

    @Test
    void twoPiecesOfEvidenceIsNotYetAnIssue() {
        assertThat(quiet().newWindow(2, false).assess().has(IssueChangeKind.NEW)).isFalse();
    }

    /**
     * The condition that makes "이전에 없던 문제" truthful. An old issue returning after a quiet spell
     * is not something the seller has never seen.
     */
    @Test
    void anIssueWithAnyHistoryIsNeverAnnouncedAsNew() {
        assertThat(quiet().newWindow(50, true).assess().has(IssueChangeKind.NEW)).isFalse();
    }

    // ---- 급증 -------------------------------------------------------------------------------

    /**
     * The guard that stops a freshly connected account alerting on every issue at once: with no
     * baseline there is no surge, however large the current count.
     */
    @Test
    void zeroToManyIsNeverASurge() {
        assertThat(quiet().surge(100, 0).assess().has(IssueChangeKind.SURGING)).isFalse();
        assertThat(quiet().surge(100, ReviewIssueThresholds.SURGE_MIN_BASELINE_TOTAL - 1)
                .assess().has(IssueChangeKind.SURGING)).isFalse();
    }

    @Test
    void aSurgeNeedsAMeaningfulAbsoluteCountNotJustARatio() {
        // baseline 8/8 weeks = 1.0 weekly, so 3 is 3x — but 3 is below the absolute floor.
        assertThat(quiet().surge(3, 8).assess().has(IssueChangeKind.SURGING)).isFalse();
        assertThat(quiet().surge(4, 8).assess().has(IssueChangeKind.SURGING)).isTrue();
    }

    @Test
    void theRatioBoundaryFiresAtExactlyTwiceTheWeeklyBaseline() {
        // baseline 16/8 weeks = 2.0 weekly; the bar is 4.0.
        assertThat(quiet().surge(4, 16).assess().has(IssueChangeKind.SURGING)).isTrue();
        // baseline 24/8 = 3.0 weekly; the bar is 6.0, so 5 does not clear it.
        assertThat(quiet().surge(5, 24).assess().has(IssueChangeKind.SURGING)).isFalse();
        assertThat(quiet().surge(6, 24).assess().has(IssueChangeKind.SURGING)).isTrue();
    }

    @Test
    void highSurgeNeedsBothTheAbsoluteLevelAndTheLargerMultiple() {
        // 8 vs 2.0 weekly = 4.0x — clears both bars.
        assertThat(quiet().surge(8, 16).assess().highSurge()).isTrue();
        // 7 clears the ratio but not SURGE_HIGH_CURRENT.
        assertThat(quiet().surge(7, 16).assess().highSurge()).isFalse();
        // 8 vs 4.0 weekly = 2.0x — clears the level but not SURGE_HIGH_RATIO.
        assertThat(quiet().surge(8, 32).assess().highSurge()).isFalse();
    }

    @Test
    void highSurgeIsFalseWheneverNoSurgeFired() {
        assertThat(quiet().surge(100, 0).assess().highSurge()).isFalse();
    }

    @Test
    void theSurgeLineCarriesItsOwnNumbersSoTheUiNeedNotParseProse() {
        IssueChangeRules.Assessment assessment = quiet().surge(9, 17).assess();

        assertThat(assessment.surgeWindowCount()).isEqualTo(9);
        assertThat(assessment.surgeBaselineWeekly()).isEqualTo(17.0 / 8);
    }

    // ---- 계속 발생 --------------------------------------------------------------------------

    @Test
    void fourActiveWeeksOutOfSixIsPersistent() {
        assertThat(quiet().activeWeeks(4).assess().has(IssueChangeKind.PERSISTENT)).isTrue();
        assertThat(quiet().activeWeeks(3).assess().has(IssueChangeKind.PERSISTENT)).isFalse();
    }

    /** A surge is the more specific statement about the same counts, so persistence stands down. */
    @Test
    void aSurgingIssueIsNotAlsoLabelledPersistent() {
        IssueChangeRules.Assessment assessment = quiet().activeWeeks(6).surge(8, 16).assess();

        assertThat(assessment.has(IssueChangeKind.SURGING)).isTrue();
        assertThat(assessment.has(IssueChangeKind.PERSISTENT)).isFalse();
    }

    // ---- 특정 상품 집중 ---------------------------------------------------------------------

    /**
     * The vacuous case the minimum-total floor exists for: one piece of evidence makes the top
     * product's share 100%, which would otherwise make this judgement unconditionally true.
     */
    @Test
    void aSingleUnattributedPieceOfEvidenceIsNeverAConcentration() {
        assertThat(quiet().concentration(1, 1).assess().has(IssueChangeKind.CONCENTRATED)).isFalse();
        assertThat(quiet().concentration(4, 4).assess().has(IssueChangeKind.CONCENTRATED)).isFalse();
    }

    @Test
    void theConcentrationBoundaryIsSixtyPercentOfAtLeastFivePieces() {
        assertThat(quiet().concentration(5, 3).assess().has(IssueChangeKind.CONCENTRATED)).isTrue();
        assertThat(quiet().concentration(5, 2).assess().has(IssueChangeKind.CONCENTRATED)).isFalse();
    }

    @Test
    void anIssueWithNoProductMappingCannotBeConcentrated() {
        // The repository excludes unattributed rows, so a mapped-nowhere issue reports top = 0.
        assertThat(quiet().concentration(20, 0).assess().has(IssueChangeKind.CONCENTRATED)).isFalse();
    }

    // ---- 개선 -------------------------------------------------------------------------------

    @Test
    void theJourneysImprovementExampleFires() {
        // ~5.2/week over 4 weeks down to ~1.3/week: 21 → 5.
        assertThat(quiet().improvement(5, 21).assess().has(IssueChangeKind.IMPROVED)).isTrue();
    }

    @Test
    void aDeclineFromAlreadyRareIsNotAnImprovement() {
        // 7/4 weeks = 1.75 weekly, below the 2.0 floor: there was never enough to improve on.
        assertThat(quiet().improvement(0, 7).assess().has(IssueChangeKind.IMPROVED)).isFalse();
    }

    @Test
    void theImprovementBoundaryIsFortyPercentOfTheWeeklyBaseline() {
        // baseline 8/4 = 2.0 weekly; the bar is 0.8 weekly = 3.2 over four weeks.
        assertThat(quiet().improvement(3, 8).assess().has(IssueChangeKind.IMPROVED)).isTrue();
        assertThat(quiet().improvement(4, 8).assess().has(IssueChangeKind.IMPROVED)).isFalse();
    }

    /** Good news never raises an issue for review. */
    @Test
    void improvementAloneDoesNotWarrantReview() {
        IssueChangeRules.Assessment assessment = quiet().improvement(5, 21).assess();

        assertThat(assessment.has(IssueChangeKind.IMPROVED)).isTrue();
        assertThat(assessment.warrantsReview()).isFalse();
    }

    @Test
    void anythingElseWarrantsReview() {
        assertThat(quiet().newWindow(3, false).assess().warrantsReview()).isTrue();
        assertThat(quiet().surge(4, 8).assess().warrantsReview()).isTrue();
        assertThat(quiet().activeWeeks(4).assess().warrantsReview()).isTrue();
        assertThat(quiet().concentration(5, 5).assess().warrantsReview()).isTrue();
    }

    // ---- overlap + display order ------------------------------------------------------------

    @Test
    void judgementsOverlapAndComeBackInDisplayOrder() {
        IssueChangeRules.Assessment assessment =
                quiet().newWindow(4, false).surge(4, 8).concentration(6, 6).assess();

        assertThat(assessment.kinds()).containsExactly(
                IssueChangeKind.NEW, IssueChangeKind.SURGING, IssueChangeKind.CONCENTRATED);
    }

    // ---- snapshot invariants -----------------------------------------------------------------

    /**
     * A share above 1.0 would mean the caller's two queries disagreed, which makes every judgement
     * derived from them untrustworthy — so it fails rather than rendering an odd number.
     */
    @Test
    void aTopProductCountAboveTheTotalIsRefused() {
        assertThatThrownBy(() -> quiet().concentration(3, 4).build())
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void moreActiveWeeksThanTheLookbackIsRefused() {
        assertThatThrownBy(() ->
                quiet().activeWeeks(ReviewIssueThresholds.PERSIST_LOOKBACK_WEEKS + 1).build())
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void negativeCountsAreRefused() {
        assertThatThrownBy(() -> new IssueWindowSnapshot(-1, false, 0, 0, 0, 0, 0, 0, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void concentrationShareOfAnEmptyWindowIsZeroNotUndefined() {
        assertThat(quiet().build().concentrationShare()).isZero();
    }
}
