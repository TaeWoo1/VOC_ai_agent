package com.sellerops.review.triage.eval;

import static com.sellerops.review.triage.ReviewTriageTier.FYI;
import static com.sellerops.review.triage.ReviewTriageTier.NEEDS_ATTENTION;
import static com.sellerops.review.triage.ReviewTriageTier.WATCH;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.sellerops.itemanalysis.eval.EvalMetrics;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.eval.TriageEvalReport.Frame;
import com.sellerops.review.triage.eval.TriageEvalReport.Population;
import com.sellerops.review.triage.eval.TriageEvalReport.Row;
import com.sellerops.review.triage.eval.TriageEvalReport.TierMetric;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The arithmetic that turns a labeling session into a number, checked without one.
 *
 * <p>Every fixture here is hand-built. That is the point: the harness that feeds this class can only
 * be run against a local database holding real reviews, so if the arithmetic were only exercised
 * there it would never be checked in CI at all, and a mis-weighted population estimate would be
 * indistinguishable from a finding.
 */
class TriageEvalReportTest {

    private static Row row(String stratum, String split, Integer rating, ReviewTriageTier rule,
                           ReviewTriageTier human, String reason) {
        return new Row(stratum, split, rating, rule, human, reason);
    }

    @Test
    @DisplayName("the confusion matrix puts the human on the row and the rule on the column")
    void confusionIsOrientedHumanByRule() {
        List<Row> rows = List.of(
                row("HIGH_L", "DEV", 5, FYI, NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION"),
                row("HIGH_L", "DEV", 5, FYI, FYI, "PRAISE_ONLY"),
                row("LOW_S", "DEV", 1, NEEDS_ATTENTION, NEEDS_ATTENTION, "DEFECT_OR_DAMAGE"),
                row("MID_M", "DEV", 3, WATCH, WATCH, "CRITIQUE_NO_REQUEST"));

        int[][] matrix = TriageEvalReport.confusion(rows);
        // human NEEDS_ATTENTION judged FYI by the rule — the cell this whole unit exists to fill.
        assertThat(matrix[0][2]).isEqualTo(1);
        assertThat(matrix[0][0]).isEqualTo(1);
        assertThat(matrix[1][1]).isEqualTo(1);
        assertThat(matrix[2][2]).isEqualTo(1);
    }

    @Test
    @DisplayName("UNCERTAIN is excluded from every count and reported on its own")
    void uncertainIsNeverScored() {
        List<Row> rows = List.of(
                row("HIGH_S", "DEV", 5, FYI, null, null),
                row("HIGH_S", "DEV", 5, FYI, FYI, "PRAISE_ONLY"));

        assertThat(TriageEvalReport.uncertain(rows)).isEqualTo(1);
        int[][] matrix = TriageEvalReport.confusion(rows);
        int total = 0;
        for (int[] r : matrix) {
            for (int cell : r) {
                total += cell;
            }
        }
        assertThat(total).as("only the labeled row is in the matrix").isEqualTo(1);
        assertThat(TriageEvalReport.gateCounts(rows).labeled()).isEqualTo(1);
    }

    /**
     * The one mapping that decides whether this contract measures what {@code v1} gated on. A
     * {@code WATCH} that leaked into the positive class would inflate recall on exactly the rows the
     * rating already handles.
     */
    @Test
    @DisplayName("WATCH and FYI are both NO_ACTION; only NEEDS_ATTENTION is a positive")
    void watchNeverCrossesTheNeedsLookLine() {
        List<Row> rows = List.of(
                row("MID_S", "DEV", 3, WATCH, WATCH, "CRITIQUE_NO_REQUEST"),
                row("LOW_S", "DEV", 1, WATCH, FYI, "TEXTLESS_OR_NOISE"),
                row("LOW_L", "DEV", 1, NEEDS_ATTENTION, NEEDS_ATTENTION, "DEFECT_OR_DAMAGE"));

        EvalMetrics.Counts counts = TriageEvalReport.gateCounts(rows);
        assertThat(counts.positives()).as("only the human NEEDS_ATTENTION row is positive").isEqualTo(1);
        assertThat(counts.truePositives()).isEqualTo(1);
        assertThat(counts.trueNegatives()).isEqualTo(2);
        assertThat(counts.falsePositives()).isZero();
    }

    @Test
    @DisplayName("a 4–5★ review a human cleared, that the rule flags, is the gated harm")
    void highRatingFalsePositivesAreTrackedSeparately() {
        List<Row> rows = List.of(
                row("HIGH_L", "DEV", 5, NEEDS_ATTENTION, FYI, "PRAISE_ONLY"),
                row("HIGH_M", "DEV", 4, FYI, FYI, "PRAISE_ONLY"),
                row("LOW_S", "DEV", 1, NEEDS_ATTENTION, FYI, "TEXTLESS_OR_NOISE"));

        EvalMetrics.Counts counts = TriageEvalReport.gateCounts(rows);
        assertThat(counts.highRatingNoAction()).as("the 1★ row is not a high-rating row").isEqualTo(2);
        assertThat(counts.highRatingFalsePositives()).isEqualTo(1);
    }

    @Test
    @DisplayName("per-tier precision counts the column, recall counts the row")
    void perTierReadsTheMatrixTheRightWayRound() {
        List<Row> rows = List.of(
                row("LOW_L", "DEV", 1, NEEDS_ATTENTION, NEEDS_ATTENTION, "DEFECT_OR_DAMAGE"),
                row("LOW_L", "DEV", 2, NEEDS_ATTENTION, FYI, "CRITIQUE_NO_REQUEST"),
                row("HIGH_L", "DEV", 5, FYI, NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION"));

        TierMetric attention = TriageEvalReport.perTier(TriageEvalReport.confusion(rows)).get(0);
        assertThat(attention.tier()).isEqualTo(NEEDS_ATTENTION);
        assertThat(attention.predicted()).as("the rule said 확인 필요 twice").isEqualTo(2);
        assertThat(attention.actual()).as("a human said 확인 필요 twice").isEqualTo(2);
        assertThat(attention.correct()).isEqualTo(1);
        assertThat(attention.precision()).isEqualTo(0.5);
        assertThat(attention.recall()).isEqualTo(0.5);
        assertThat(attention.precisionLowerBound()).isLessThan(0.5);
    }

    @Test
    @DisplayName("what the rule missed is grouped by the reason a human gave, commonest first")
    void missesAreNamedNotJustCounted() {
        List<Row> rows = List.of(
                row("HIGH_L", "DEV", 5, FYI, NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION"),
                row("HIGH_M", "DEV", 5, FYI, NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION"),
                row("MID_L", "DEV", 3, WATCH, NEEDS_ATTENTION, "DELIVERY_PROBLEM"),
                row("LOW_L", "DEV", 1, NEEDS_ATTENTION, NEEDS_ATTENTION, "DEFECT_OR_DAMAGE"));

        Map<String, Integer> byReason = TriageEvalReport.missedByReason(rows);
        assertThat(byReason).containsExactly(
                Map.entry("PRAISE_WITH_CONCESSION", 2), Map.entry("DELIVERY_PROBLEM", 1));
        assertThat(byReason).as("a review the rule caught is not a miss")
                .doesNotContainKey("DEFECT_OR_DAMAGE");
        assertThat(TriageEvalReport.missedByRating(rows))
                .containsExactly(Map.entry("3★", 1), Map.entry("5★", 2));
    }

    @Test
    @DisplayName("a censused stratum weighs one, a sampled one weighs the whole band it stands for")
    void populationWeightsByInverseInclusion() {
        Frame frame = new Frame(Map.of("LOW_L", 3, "HIGH_S", 2440), Map.of("LOW_L", 3, "HIGH_S", 30));
        assertThat(frame.weight("LOW_L")).isEqualTo(1.0);
        assertThat(frame.weight("HIGH_S")).isEqualTo(2440.0 / 30);

        List<Row> rows = List.of(
                row("LOW_L", "DEV", 1, NEEDS_ATTENTION, NEEDS_ATTENTION, "DEFECT_OR_DAMAGE"),
                row("HIGH_S", "DEV", 5, FYI, NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION"));

        Population population = TriageEvalReport.population(rows, frame);
        assertThat(population.needsAttention()).isCloseTo(1 + 2440.0 / 30, within(0.01));
        assertThat(population.flagged()).as("only the 1★ row is flagged by the rule").isEqualTo(1.0);
        assertThat(population.missed()).isCloseTo(2440.0 / 30, within(0.01));
    }

    /**
     * The censused strata are six of the nine, and they carry no sampling error at all — every review
     * in them was labeled. An estimator that ignored the finite-population correction would attach a
     * confidence interval to a complete count, which reads as uncertainty that does not exist.
     */
    @Test
    @DisplayName("a censused stratum contributes no uncertainty")
    void aCensusHasNoSamplingError() {
        // Two reviews in the band, both labeled: nothing was left unobserved, so there is nothing to
        // be uncertain about.
        Frame censused = new Frame(Map.of("MID_M", 2), Map.of("MID_M", 2));
        List<Row> rows = List.of(
                row("MID_M", "DEV", 3, WATCH, NEEDS_ATTENTION, "DELIVERY_PROBLEM"),
                row("MID_M", "DEV", 3, WATCH, FYI, "PRAISE_ONLY"));

        assertThat(TriageEvalReport.population(rows, censused).needsAttentionHalfWidth()).isZero();

        Frame sampled = new Frame(Map.of("MID_M", 3000), Map.of("MID_M", 2));
        assertThat(TriageEvalReport.population(rows, sampled).needsAttentionHalfWidth())
                .as("the same two rows drawn from a large band are uncertain")
                .isGreaterThan(0.0);
    }

    @Test
    @DisplayName("UNCERTAIN weight is reported as a hole, never spread over the labeled rows")
    void uncertainMassIsNamedNotRedistributed() {
        Frame frame = new Frame(Map.of("HIGH_S", 2440), Map.of("HIGH_S", 30));
        List<Row> rows = List.of(
                row("HIGH_S", "DEV", 5, FYI, null, null),
                row("HIGH_S", "DEV", 5, FYI, NEEDS_ATTENTION, "DELIVERY_PROBLEM"));

        Population population = TriageEvalReport.population(rows, frame);
        assertThat(population.unestimated()).isCloseTo(2440.0 / 30, within(0.01));
        assertThat(population.needsAttention())
                .as("one labeled row still stands for exactly one row's worth of weight")
                .isCloseTo(2440.0 / 30, within(0.01));
    }

    @Test
    @DisplayName("a split selects only its own half")
    void splitFiltersRows() {
        List<Row> rows = List.of(
                row("HIGH_S", "DEV", 5, FYI, FYI, "PRAISE_ONLY"),
                row("HIGH_S", "HOLDOUT", 5, FYI, FYI, "PRAISE_ONLY"),
                row("HIGH_S", "HOLDOUT", 4, FYI, FYI, "PRAISE_ONLY"));

        assertThat(TriageEvalReport.only(rows, "DEV")).hasSize(1);
        assertThat(TriageEvalReport.only(rows, "HOLDOUT")).hasSize(2);
    }
}
