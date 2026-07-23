package com.sellerops.itemanalysis.eval;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.sellerops.itemanalysis.eval.EvalMetrics.Counts;
import com.sellerops.itemanalysis.eval.EvalMetrics.Verdict;
import org.junit.jupiter.api.Test;

/**
 * The go/no-go arithmetic, verified offline — no database, no corpus, no labeling session.
 *
 * <p>This is the part of the evaluation that decides whether a detector may be put in front of an
 * operator, so it has to be right before there is anything to evaluate. The bars themselves are
 * pinned here as literals: they were chosen in `contracts/review-eval/naver/v1/RUBRIC.md` BEFORE any
 * candidate existed, and a threshold that can drift silently to meet a result is not a threshold.
 */
class EvalMetricsTest {

    /** A comfortably-passing seed: 180 TP / 20 FP, 200 positives, no high-rating misfires. */
    private static Counts passing() {
        return new Counts(180, 20, 20, 100, 5, 0, 300);
    }

    @Test
    void theBarsAreTheOnesTheRubricCommittedTo() {
        assertThat(EvalMetrics.MIN_LABELED).isEqualTo(200);
        assertThat(EvalMetrics.MIN_POSITIVES).isEqualTo(40);
        assertThat(EvalMetrics.MIN_PRECISION_LOWER_BOUND).isEqualTo(0.80);
        assertThat(EvalMetrics.MIN_RECALL).isEqualTo(0.30);
        assertThat(EvalMetrics.MAX_HIGH_RATING_FP_RATE).isEqualTo(0.05);
        assertThat(EvalMetrics.MIN_HIGH_RATING_NO_ACTION).isEqualTo(30);
    }

    @Test
    void aStrongDetectorClearsEveryGate() {
        Verdict v = EvalMetrics.evaluate(passing());

        assertThat(v.adequate()).isTrue();
        assertThat(v.pass()).isTrue();
        assertThat(v.precision()).isEqualTo(0.90);
        assertThat(v.recall()).isEqualTo(0.90);
    }

    @Test
    void anUnderPoweredSeedDecidesNothingInEitherDirection() {
        // 20/20 correct is a perfect point estimate on a sample too small to mean anything. It must
        // not pass — and the reason must say the seed is the problem, not the detector, or the next
        // reader concludes the detector failed.
        Verdict v = EvalMetrics.evaluate(new Counts(20, 0, 0, 10, 0, 0, 10));

        assertThat(v.adequate()).isFalse();
        assertThat(v.pass()).isFalse();
        assertThat(v.reason()).contains("adequacy floor").contains("do not decide");
    }

    @Test
    void enoughRowsButTooFewPositivesIsAlsoInadequate() {
        // 300 labeled rows carrying 10 positives cannot measure recall, however large the corpus.
        Verdict v = EvalMetrics.evaluate(new Counts(10, 0, 0, 290, 0, 0, 200));

        assertThat(v.adequate()).isFalse();
        assertThat(v.reason()).contains("10/40 positive");
    }

    @Test
    void aSeedWithNoHappyCustomersCannotClearTheHappyCustomerGate() {
        // The gate exists to catch "you told a seller a happy customer needs handling". On a seed
        // drawn only from low-rated reviews there are no happy customers in it at all, 0/0 reads as
        // a 0.00 rate, and the gate passes on no evidence whatsoever — vacuously clearing the one
        // check that protects the case nobody labels much of.
        Verdict v = EvalMetrics.evaluate(new Counts(180, 20, 20, 100, 0, 0, 0));

        assertThat(v.adequate()).isFalse();
        assertThat(v.pass()).isFalse();
        assertThat(v.reason()).contains("0/30 high-rated NO_ACTION");
    }

    @Test
    void aThinSliceOfHighRatedReviewsIsAlsoRefused() {
        // At the 0.05 bar one false positive in 20 is already a failure, so a handful of rows cannot
        // separate 0.05 from zero however clean the result looks.
        Verdict v = EvalMetrics.evaluate(new Counts(180, 20, 20, 100, 0, 0, 20));

        assertThat(v.adequate()).isFalse();
        assertThat(v.reason()).contains("20/30 high-rated NO_ACTION");
    }

    @Test
    void precisionIsGatedOnTheLowerBoundNotThePointEstimate() {
        // 165 TP / 35 FP → point estimate 0.825, comfortably over the 0.80 bar; the Wilson lower
        // bound is below it. Gating on the point estimate would pass a detector whose true precision
        // is not demonstrably above the bar at all.
        Verdict v = EvalMetrics.evaluate(new Counts(165, 35, 20, 100, 0, 0, 300));

        assertThat(v.precision()).isGreaterThan(EvalMetrics.MIN_PRECISION_LOWER_BOUND);
        assertThat(v.precisionLowerBound()).isLessThan(EvalMetrics.MIN_PRECISION_LOWER_BOUND);
        assertThat(v.pass()).isFalse();
        assertThat(v.reason()).contains("Precision lower bound");
    }

    @Test
    void aPreciseButNearlyBlindDetectorFailsOnRecall() {
        // Exactly the shape rules-v1 is expected to have: what it flags is right, and it flags almost
        // nothing. Precision alone must not carry a detector past the bar.
        Verdict v = EvalMetrics.evaluate(new Counts(60, 2, 140, 100, 0, 0, 300));

        assertThat(v.precisionLowerBound()).isGreaterThan(EvalMetrics.MIN_PRECISION_LOWER_BOUND);
        assertThat(v.recall()).isEqualTo(0.30, within(1e-9));
        assertThat(v.pass()).isTrue();   // 0.30 is the bar, and the bar is inclusive

        Verdict justUnder = EvalMetrics.evaluate(new Counts(59, 2, 141, 100, 0, 0, 300));
        assertThat(justUnder.pass()).isFalse();
        assertThat(justUnder.reason()).contains("Recall");
    }

    @Test
    void flaggingHappyCustomersFailsEvenWithGoodAggregateNumbers() {
        // The specific harm the rubric singles out. Aggregate precision here is 0.90 — passing — but
        // 30 of 300 four-and-five-star NO_ACTION reviews were flagged, which is what a seller would
        // actually feel.
        Verdict v = EvalMetrics.evaluate(new Counts(180, 20, 20, 100, 0, 30, 300));

        assertThat(v.precisionLowerBound()).isGreaterThan(EvalMetrics.MIN_PRECISION_LOWER_BOUND);
        assertThat(v.highRatingFalsePositiveRate()).isEqualTo(0.10);
        assertThat(v.pass()).isFalse();
        assertThat(v.reason()).contains("High-rating false-positive rate");
    }

    @Test
    void aDetectorThatFlagsNothingScoresZeroPrecisionNotPerfectPrecision() {
        // 0/0 is the most flattering possible lie: it reads as flawless while detecting nothing.
        Verdict v = EvalMetrics.evaluate(new Counts(0, 0, 200, 100, 0, 0, 300));

        assertThat(v.precision()).isZero();
        assertThat(v.precisionLowerBound()).isZero();
        assertThat(v.pass()).isFalse();
    }

    @Test
    void uncertainLabelsAreExcludedFromEveryMetric() {
        Counts withUncertain = new Counts(180, 20, 20, 100, 500, 0, 300);

        Verdict v = EvalMetrics.evaluate(withUncertain);

        assertThat(withUncertain.labeled()).isEqualTo(320);   // the 500 are not in it
        assertThat(v.precision()).isEqualTo(EvalMetrics.evaluate(passing()).precision());
        assertThat(v.recall()).isEqualTo(EvalMetrics.evaluate(passing()).recall());
    }

    @Test
    void wilsonStaysSaneWhereTheNormalApproximationBreaks() {
        // At 20/20 the normal interval reports ±0 and would clear an 0.80 bar outright. Wilson does
        // not — which is the entire reason it is used here.
        assertThat(EvalMetrics.wilsonLowerBound(20, 20)).isLessThan(0.85).isGreaterThan(0.80);
        assertThat(EvalMetrics.wilsonLowerBound(200, 200)).isGreaterThan(0.98);
        assertThat(EvalMetrics.wilsonLowerBound(0, 0)).isZero();
        // Known value, so a refactor of the formula cannot drift unnoticed.
        assertThat(EvalMetrics.wilsonLowerBound(90, 100)).isEqualTo(0.825, within(0.005));
    }
}
