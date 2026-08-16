package com.sellerops.review.triage.eval;

import com.sellerops.itemanalysis.eval.EvalMetrics;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * The arithmetic of a calibration run, separated from the harness that feeds it for the same reason
 * {@link EvalMetrics} is: this decides what the numbers say, so it has to be verifiable without a
 * database, a corpus, or a labeling session.
 *
 * <p><b>It never sees review text.</b> A {@link Row} carries a stratum, a split, a rating, two tiers
 * and a reason code — everything needed to compute a metric and nothing that could be printed by
 * accident.
 *
 * <p>Two readings, as RUBRIC v2 §4.4 requires. The <b>gate</b> reading is unweighted over the
 * labeled set and is what {@code review-eval/naver/v1} §5 gates on. The <b>population</b> reading
 * reweights each row by its stratum's inverse inclusion probability and answers "how many of the
 * whole corpus" — reported separately, always with its standard error, because one flipped label in
 * a thinly sampled stratum moves it by dozens of reviews.
 */
public final class TriageEvalReport {

    /**
     * One labeled review, already reduced to numbers.
     *
     * @param human the tier a person chose, or {@code null} for {@code UNCERTAIN} — excluded from
     *              every metric (RUBRIC v1 §4) and reported separately
     */
    public record Row(String stratum, String split, Integer rating, ReviewTriageTier rule,
                      ReviewTriageTier human, String reasonCode) {
    }

    /** Per-stratum frame size and how many rows the pre-committed allocation draws from it. */
    public record Frame(Map<String, Integer> inFrame, Map<String, Integer> drawn) {

        /** Inverse inclusion probability. A row in a censused stratum stands for itself alone. */
        public double weight(String stratum) {
            int n = drawn.getOrDefault(stratum, 0);
            return n == 0 ? 0.0 : (double) inFrame.getOrDefault(stratum, 0) / n;
        }
    }

    /** Estimated corpus totals, with the half-width of a 95% interval. */
    public record Population(double flagged, double flaggedHalfWidth, double needsAttention,
                             double needsAttentionHalfWidth, double missed, double unestimated) {
    }

    private static final List<ReviewTriageTier> TIERS =
            List.of(ReviewTriageTier.NEEDS_ATTENTION, ReviewTriageTier.WATCH, ReviewTriageTier.FYI);

    private TriageEvalReport() {
    }

    /** Human tier (row) × rule tier (column), by {@link ReviewTriageRules#rank}. */
    public static int[][] confusion(List<Row> rows) {
        int[][] matrix = new int[3][3];
        for (Row row : rows) {
            if (row.human() == null) {
                continue;
            }
            matrix[ReviewTriageRules.rank(row.human())][ReviewTriageRules.rank(row.rule())]++;
        }
        return matrix;
    }

    public static int uncertain(List<Row> rows) {
        return (int) rows.stream().filter(r -> r.human() == null).count();
    }

    /**
     * The v1 gate counts, over the {@code NEEDS_LOOK} partition v1 defined.
     *
     * <p>{@code NEEDS_ATTENTION} is v1's {@code NEEDS_LOOK}; {@code WATCH} and {@code FYI} are both
     * {@code NO_ACTION} (RUBRIC v2 §2). A {@code WATCH}/{@code FYI} confusion is a product-quality
     * finding and must not move a review across this line.
     */
    public static EvalMetrics.Counts gateCounts(List<Row> rows) {
        int tp = 0;
        int fp = 0;
        int fn = 0;
        int tn = 0;
        int highRatingFp = 0;
        int highRatingNoAction = 0;
        for (Row row : rows) {
            if (row.human() == null) {
                continue;
            }
            boolean needsLook = row.human() == ReviewTriageTier.NEEDS_ATTENTION;
            boolean flagged = row.rule() == ReviewTriageTier.NEEDS_ATTENTION;
            if (needsLook && flagged) {
                tp++;
            } else if (needsLook) {
                fn++;
            } else if (flagged) {
                fp++;
            } else {
                tn++;
            }
            if (!needsLook && row.rating() != null && row.rating() >= 4) {
                highRatingNoAction++;
                if (flagged) {
                    highRatingFp++;
                }
            }
        }
        return new EvalMetrics.Counts(tp, fp, fn, tn, uncertain(rows), highRatingFp, highRatingNoAction);
    }

    /** Precision, recall and the Wilson lower bound of precision, for one tier against itself. */
    public record TierMetric(ReviewTriageTier tier, int predicted, int actual, int correct,
                             double precision, double precisionLowerBound, double recall) {
    }

    public static List<TierMetric> perTier(int[][] matrix) {
        List<TierMetric> out = new ArrayList<>();
        for (ReviewTriageTier tier : TIERS) {
            int i = ReviewTriageRules.rank(tier);
            int correct = matrix[i][i];
            int predicted = 0;
            int actual = 0;
            for (int k = 0; k < 3; k++) {
                predicted += matrix[k][i];
                actual += matrix[i][k];
            }
            out.add(new TierMetric(tier, predicted, actual, correct,
                    predicted == 0 ? 0.0 : (double) correct / predicted,
                    EvalMetrics.wilsonLowerBound(correct, predicted),
                    actual == 0 ? 0.0 : (double) correct / actual));
        }
        return out;
    }

    /**
     * What the rule missed, named rather than counted: reviews a human called
     * {@code NEEDS_ATTENTION} that the rule did not, grouped by the reason the human gave.
     *
     * <p>This is the false-negative taxonomy RUBRIC v2 §6.2 reads on {@code DEV}. A single recall
     * number says a rule is incomplete; this says what it is blind to, which is the only thing that
     * can license a change.
     */
    public static Map<String, Integer> missedByReason(List<Row> rows) {
        Map<String, Integer> counts = new TreeMap<>();
        for (Row row : rows) {
            if (row.human() == ReviewTriageTier.NEEDS_ATTENTION
                    && row.rule() != ReviewTriageTier.NEEDS_ATTENTION) {
                counts.merge(row.reasonCode() == null ? "(none)" : row.reasonCode(), 1, Integer::sum);
            }
        }
        return sortedByCountDesc(counts);
    }

    /** The same misses by rating band, which is what says whether the blindness is the 4–5★ one. */
    public static Map<String, Integer> missedByRating(List<Row> rows) {
        Map<String, Integer> counts = new TreeMap<>();
        for (Row row : rows) {
            if (row.human() == ReviewTriageTier.NEEDS_ATTENTION
                    && row.rule() != ReviewTriageTier.NEEDS_ATTENTION) {
                counts.merge(row.rating() == null ? "none" : row.rating() + "★", 1, Integer::sum);
            }
        }
        return counts;
    }

    private static Map<String, Integer> sortedByCountDesc(Map<String, Integer> counts) {
        Map<String, Integer> out = new LinkedHashMap<>();
        counts.entrySet().stream()
                .sorted(Comparator.<Map.Entry<String, Integer>>comparingInt(Map.Entry::getValue).reversed()
                        .thenComparing(Map.Entry::getKey))
                .forEach(e -> out.put(e.getKey(), e.getValue()));
        return out;
    }

    /**
     * Horvitz–Thompson totals over the whole frame, with a stratified 95% half-width.
     *
     * <p>The finite-population correction matters here rather than being a formality: six of the
     * nine strata are censused, so they contribute exactly zero variance and all of the uncertainty
     * comes from the three sampled 4–5★ strata. That is the honest shape of this estimate and the
     * reason it is reported beside the gate reading rather than instead of it.
     *
     * <p>{@code UNCERTAIN} rows are not redistributed over the rest. Their weight is returned as
     * {@code unestimated} — a named hole is a finding; silently inflating the labeled rows to cover
     * it is not.
     */
    public static Population population(List<Row> rows, Frame frame) {
        Map<String, List<Row>> byStratum = new LinkedHashMap<>();
        for (Row row : rows) {
            byStratum.computeIfAbsent(row.stratum(), k -> new ArrayList<>()).add(row);
        }
        double flagged = 0;
        double needsAttention = 0;
        double missed = 0;
        double unestimated = 0;
        double flaggedVar = 0;
        double needsVar = 0;
        for (Map.Entry<String, List<Row>> entry : byStratum.entrySet()) {
            String stratum = entry.getKey();
            List<Row> stratumRows = entry.getValue();
            double weight = frame.weight(stratum);
            double bigN = frame.inFrame().getOrDefault(stratum, 0);
            int usable = 0;
            int flaggedHere = 0;
            int needsHere = 0;
            for (Row row : stratumRows) {
                if (row.human() == null) {
                    unestimated += weight;
                    continue;
                }
                usable++;
                if (row.rule() == ReviewTriageTier.NEEDS_ATTENTION) {
                    flaggedHere++;
                }
                if (row.human() == ReviewTriageTier.NEEDS_ATTENTION) {
                    needsHere++;
                    if (row.rule() != ReviewTriageTier.NEEDS_ATTENTION) {
                        missed += weight;
                    }
                }
            }
            flagged += flaggedHere * weight;
            needsAttention += needsHere * weight;
            flaggedVar += stratumVariance(bigN, usable, flaggedHere);
            needsVar += stratumVariance(bigN, usable, needsHere);
        }
        return new Population(flagged, 1.96 * Math.sqrt(flaggedVar), needsAttention,
                1.96 * Math.sqrt(needsVar), missed, unestimated);
    }

    /**
     * {@code N² (1 − n/N) p(1−p) / (n − 1)}; zero for a census and for a stratum of one.
     *
     * <p>{@code n} here is the number of rows actually SCORED, which is the drawn count minus the
     * {@code UNCERTAIN} rows — while {@link Frame#weight} divides by the drawn count. The two differ
     * only when a stratum contains an {@code UNCERTAIN} row, and the difference errs toward a wider
     * interval. That is the right direction: an excluded row is genuinely unobserved, and the
     * alternative — pretending the stratum was sampled as densely as it was drawn — would report
     * more confidence than the session earned.
     */
    private static double stratumVariance(double bigN, int n, int successes) {
        if (n < 2 || bigN <= 0 || n >= bigN) {
            return 0.0;
        }
        double p = (double) successes / n;
        return bigN * bigN * (1 - n / bigN) * p * (1 - p) / (n - 1);
    }

    public static List<Row> only(List<Row> rows, String split) {
        return rows.stream().filter(r -> r.split().equals(split)).toList();
    }
}
