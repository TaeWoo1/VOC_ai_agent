package com.sellerops.itemanalysis.eval;

/**
 * The go/no-go arithmetic for a review-analysis detector, as specified by
 * {@code contracts/review-eval/naver/v1/RUBRIC.md}.
 *
 * <p>Pure and separate from the harness that feeds it, deliberately: this is the part that decides
 * whether a detector may be shown to an operator, so it has to be verifiable without a database, a
 * corpus, or a labeling session. {@code ReviewAnalyzerEvalIT} only supplies counts.
 *
 * <p>Test-source only. An evaluation harness is not product code and must never be reachable from
 * a running service.
 */
public final class EvalMetrics {

    /** Adequacy floor — below this the numbers are descriptive, not decisive (RUBRIC §4). */
    public static final int MIN_LABELED = 200;
    public static final int MIN_POSITIVES = 40;

    /** Go/no-go bars (RUBRIC §5). */
    public static final double MIN_PRECISION_LOWER_BOUND = 0.80;
    public static final double MIN_RECALL = 0.30;
    public static final double MAX_HIGH_RATING_FP_RATE = 0.05;

    /** z for a two-sided 95% interval. */
    private static final double Z = 1.959963984540054;

    private EvalMetrics() {
    }

    /**
     * Confusion counts over the labeled set, with {@code UNCERTAIN} already excluded.
     *
     * <p>{@code highRatingFalsePositives} counts 4–5★ reviews labeled {@code NO_ACTION} that the
     * detector flagged; {@code highRatingNoAction} is how many such reviews exist. They are tracked
     * separately from the overall confusion matrix because the rubric gates on that specific harm —
     * telling a seller a happy customer needs handling — not on aggregate precision alone.
     */
    public record Counts(int truePositives, int falsePositives, int falseNegatives, int trueNegatives,
                         int uncertain, int highRatingFalsePositives, int highRatingNoAction) {

        public int labeled() {
            return truePositives + falsePositives + falseNegatives + trueNegatives;
        }

        public int positives() {
            return truePositives + falseNegatives;
        }
    }

    public record Verdict(boolean adequate, boolean pass, double precision, double precisionLowerBound,
                          double recall, double highRatingFalsePositiveRate, String reason) {
    }

    /**
     * Evaluate one detector's counts against the rubric.
     *
     * <p>An inadequate seed yields {@code pass = false} with a reason — never a quiet "fail", and
     * never a pass. A seed too small to decide must not read as a decision in either direction.
     */
    public static Verdict evaluate(Counts c) {
        int flagged = c.truePositives() + c.falsePositives();
        double precision = flagged == 0 ? 0.0 : (double) c.truePositives() / flagged;
        double lowerBound = wilsonLowerBound(c.truePositives(), flagged);
        double recall = c.positives() == 0 ? 0.0 : (double) c.truePositives() / c.positives();
        double highRatingFpRate = c.highRatingNoAction() == 0
                ? 0.0
                : (double) c.highRatingFalsePositives() / c.highRatingNoAction();

        if (c.labeled() < MIN_LABELED || c.positives() < MIN_POSITIVES) {
            return new Verdict(false, false, precision, lowerBound, recall, highRatingFpRate,
                    "Seed below the adequacy floor (" + c.labeled() + "/" + MIN_LABELED + " labeled, "
                            + c.positives() + "/" + MIN_POSITIVES + " positive) — these numbers "
                            + "describe the sample, they do not decide anything.");
        }
        if (lowerBound < MIN_PRECISION_LOWER_BOUND) {
            return new Verdict(true, false, precision, lowerBound, recall, highRatingFpRate,
                    "Precision lower bound " + round(lowerBound) + " < " + MIN_PRECISION_LOWER_BOUND);
        }
        if (recall < MIN_RECALL) {
            return new Verdict(true, false, precision, lowerBound, recall, highRatingFpRate,
                    "Recall " + round(recall) + " < " + MIN_RECALL);
        }
        if (highRatingFpRate > MAX_HIGH_RATING_FP_RATE) {
            return new Verdict(true, false, precision, lowerBound, recall, highRatingFpRate,
                    "High-rating false-positive rate " + round(highRatingFpRate) + " > "
                            + MAX_HIGH_RATING_FP_RATE);
        }
        return new Verdict(true, true, precision, lowerBound, recall, highRatingFpRate,
                "All gates cleared. Passing the bar permits SURFACING to an operator; it is not a "
                        + "claim the detector is correct on data outside this seed.");
    }

    /**
     * Wilson score interval, lower bound.
     *
     * <p>Not the normal approximation: at the sample sizes an internal labeling session realistically
     * produces, and at precisions near 1.0, the normal interval is badly wrong — at 20/20 it reports
     * ±0, which would let a 20-sample run clear an 0.80 bar outright. Wilson stays sane at the
     * boundary, which is exactly where a detector under evaluation will sit.
     *
     * <p>{@code n == 0} yields 0.0: a detector that flagged nothing has no demonstrated precision,
     * and reporting 1.0 for an empty numerator would be the most flattering possible lie.
     */
    public static double wilsonLowerBound(int successes, int n) {
        if (n <= 0) {
            return 0.0;
        }
        double phat = (double) successes / n;
        double z2 = Z * Z;
        double denominator = 1 + z2 / n;
        double centre = phat + z2 / (2 * n);
        double margin = Z * Math.sqrt(phat * (1 - phat) / n + z2 / (4.0 * n * n));
        return Math.max(0.0, (centre - margin) / denominator);
    }

    private static String round(double v) {
        return String.format("%.3f", v);
    }
}
