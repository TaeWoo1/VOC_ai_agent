package com.sellerops.review.triage.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.itemanalysis.eval.EvalMetrics;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.eval.TriageEvalReport.Frame;
import com.sellerops.review.triage.eval.TriageEvalReport.Population;
import com.sellerops.review.triage.eval.TriageEvalReport.Row;
import com.sellerops.review.triage.eval.TriageEvalReport.TierMetric;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Measures {@code Review Triage v1} against the human labels of
 * {@code contracts/review-eval/naver/v2/RUBRIC.md}.
 *
 * <p><b>Gated and local</b>, exactly like {@code ReviewAnalyzerEvalIT}: it reads real review bodies
 * out of a local database, so it never runs in CI and never runs by accident. Set
 * {@code RUN_REVIEW_EVAL=true} plus {@code REVIEW_EVAL_JDBC_URL}, {@code REVIEW_EVAL_DB_USER} and
 * {@code REVIEW_EVAL_DB_PASSWORD}. Nothing is written; one SELECT is issued on a read-only
 * connection.
 *
 * <p><b>Output is counts and rates only.</b> No body, no raw {@code 리뷰글번호}, no fingerprint, no
 * product, no seller identity reaches stdout. Run with {@code --info} to see the report.
 *
 * <p>It re-derives the sample rather than reading a list of drawn rows, which is what makes RUBRIC
 * v2 §4.3 more than a claim: if the draw were not reproducible, the labeled set and the re-derived
 * set would not agree, and the integrity block below would say so.
 *
 * <p>It deliberately does NOT assert a verdict. The rating-only rule is expected to miss the
 * high-rating complaints it structurally cannot see — that is the finding this harness exists to
 * quantify, not a broken build. Turning the baseline red would make the only way to a green suite
 * be to stop measuring.
 */
@EnabledIfEnvironmentVariable(named = "RUN_REVIEW_EVAL", matches = "true")
class ReviewTriageEvalIT {

    private static final Path LABELS =
            Path.of("..", "contracts", "review-eval", "naver", "v2", "labels.json");

    private record Label(ReviewTriageTier tier, String reasonCode) {
    }

    private record FrameRow(String fingerprint, String stratum, Integer rating, ReviewTriageTier rule,
                            String order) {
    }

    @Test
    void measureReviewTriageV1AgainstTheLabelledSample() throws Exception {
        Map<String, Label> labels = readLabels();
        List<FrameRow> frameRows = readFrame();

        Map<String, List<FrameRow>> byStratum = new LinkedHashMap<>();
        for (FrameRow row : frameRows) {
            byStratum.computeIfAbsent(row.stratum(), k -> new ArrayList<>()).add(row);
        }

        Map<String, Integer> inFrame = new LinkedHashMap<>();
        Map<String, Integer> drawnCounts = new LinkedHashMap<>();
        List<FrameRow> drawn = new ArrayList<>();
        for (String stratum : CalibrationSample.STRATA) {
            List<FrameRow> pool = new ArrayList<>(byStratum.getOrDefault(stratum, List.of()));
            pool.sort(Comparator.comparing(FrameRow::order));
            int take = Math.min(pool.size(), CalibrationSample.ALLOCATION.get(stratum));
            inFrame.put(stratum, pool.size());
            drawnCounts.put(stratum, take);
            drawn.addAll(pool.subList(0, take));
        }

        List<Row> rows = new ArrayList<>();
        int unlabelledInDraw = 0;
        for (FrameRow row : drawn) {
            Label label = labels.get(row.fingerprint());
            if (label == null) {
                unlabelledInDraw++;
                continue;
            }
            rows.add(new Row(row.stratum(), CalibrationSample.splitOf(row.fingerprint()), row.rating(),
                    row.rule(), label.tier(), label.reasonCode()));
        }
        long labelledOutsideDraw = labels.size() - (drawn.size() - unlabelledInDraw);

        StringBuilder out = new StringBuilder("\n\nreview-triage calibration — rules-v1 (rating + textless only)\n\n");
        out.append("  frame and draw\n    stratum   in frame    drawn        π   labeled\n");
        for (String stratum : CalibrationSample.STRATA) {
            long labelled = rows.stream().filter(r -> r.stratum().equals(stratum)).count();
            out.append(String.format("    %-9s %8d %8d   %.4f  %8d%n", stratum, inFrame.get(stratum),
                    drawnCounts.get(stratum), inFrame.get(stratum) == 0
                            ? 0.0 : (double) drawnCounts.get(stratum) / inFrame.get(stratum), labelled));
        }
        out.append(String.format("    %-9s %8d %8d            %8d%n", "TOTAL",
                frameRows.size(), drawn.size(), rows.size()));
        out.append(String.format("%n  integrity: %d drawn rows carry no label, %d labels fall outside the "
                + "re-derived draw%n", unlabelledInDraw, labelledOutsideDraw));
        if (labelledOutsideDraw != 0) {
            out.append("    ⚠ the draw did not reproduce, or labels came from a different corpus — "
                    + "every number below is suspect\n");
        }

        for (String scope : List.of("ALL", "DEV", "HOLDOUT")) {
            List<Row> scoped = scope.equals("ALL") ? rows : TriageEvalReport.only(rows, scope);
            out.append(section(scope, scoped));
        }

        Population population = TriageEvalReport.population(rows, new Frame(inFrame, drawnCounts));
        out.append(String.format("""

                  population estimate over all %d reviews in the frame (RUBRIC v2 §4.4 — descriptive)
                    rule flags 확인 필요 for      %,8.0f  ± %,.0f
                    a human would flag           %,8.0f  ± %,.0f
                    the rule misses              %,8.0f
                    unestimated (UNCERTAIN)      %,8.0f
                    Six of nine strata are censused, so all of this uncertainty is the 4–5★ bands.
                %n""", frameRows.size(), population.flagged(), population.flaggedHalfWidth(),
                population.needsAttention(), population.needsAttentionHalfWidth(),
                population.missed(), population.unestimated()));

        System.out.print(out);
    }

    private static String section(String scope, List<Row> rows) {
        int[][] matrix = TriageEvalReport.confusion(rows);
        StringBuilder out = new StringBuilder(String.format("%n  ── %s ── %d labeled, %d UNCERTAIN excluded%n",
                scope, rows.size() - TriageEvalReport.uncertain(rows), TriageEvalReport.uncertain(rows)));
        out.append("    confusion (rows = human, columns = rule)\n");
        out.append("                    확인 필요   지켜보기      참고\n");
        String[] names = {"확인 필요", "지켜보기", "  참고  "};
        for (int i = 0; i < 3; i++) {
            out.append(String.format("      %-9s %8d %9d %9d%n", names[i], matrix[i][0], matrix[i][1], matrix[i][2]));
        }
        out.append("\n    per tier                예측     실제     맞음   precision  (95% low)   recall\n");
        for (TierMetric m : TriageEvalReport.perTier(matrix)) {
            out.append(String.format("      %-16s %8d %8d %8d %10.3f %10.3f %8.3f%n",
                    m.tier(), m.predicted(), m.actual(), m.correct(), m.precision(),
                    m.precisionLowerBound(), m.recall()));
        }

        EvalMetrics.Counts counts = TriageEvalReport.gateCounts(rows);
        EvalMetrics.Verdict verdict = EvalMetrics.evaluate(counts);
        out.append(String.format("""
                %n    v1 gate (NEEDS_ATTENTION = NEEDS_LOOK; WATCH and FYI both NO_ACTION)
                      tp=%d fp=%d fn=%d tn=%d
                      precision=%.3f (95%% lower bound %.3f)  recall=%.3f
                      high-rating false-positive rate=%.3f over %d high-rated NO_ACTION reviews
                      adequate=%s  pass=%s
                      %s%n""",
                counts.truePositives(), counts.falsePositives(), counts.falseNegatives(),
                counts.trueNegatives(), verdict.precision(), verdict.precisionLowerBound(),
                verdict.recall(), verdict.highRatingFalsePositiveRate(), counts.highRatingNoAction(),
                verdict.adequate(), verdict.pass(), verdict.reason()));

        Map<String, Integer> byReason = TriageEvalReport.missedByReason(rows);
        out.append(String.format("%n    what the rule missed (%d reviews a human called 확인 필요)%n",
                byReason.values().stream().mapToInt(Integer::intValue).sum()));
        if (byReason.isEmpty()) {
            out.append("      (none)\n");
        }
        for (Map.Entry<String, Integer> e : byReason.entrySet()) {
            out.append(String.format("      %-26s %4d%n", e.getKey(), e.getValue()));
        }
        out.append("      by rating: ").append(TriageEvalReport.missedByRating(rows)).append('\n');
        return out.toString();
    }

    /** The frame of RUBRIC v2 §4.1: real NAVER export rows, which are the ones carrying an id. */
    private static List<FrameRow> readFrame() throws Exception {
        List<FrameRow> rows = new ArrayList<>();
        try (Connection db = DriverManager.getConnection(
                requireEnv("REVIEW_EVAL_JDBC_URL"),
                requireEnv("REVIEW_EVAL_DB_USER"),
                System.getenv("REVIEW_EVAL_DB_PASSWORD"));
             PreparedStatement ps = db.prepareStatement(
                     "select r.external_id, r.body, r.rating from reviews r "
                             + "join channels c on c.id = r.channel_id "
                             + "where c.code = 'NAVER' and r.external_id is not null")) {
            db.setReadOnly(true);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String fingerprint = ReviewIdFingerprint.of(rs.getString("external_id"));
                    Integer rating = rs.getObject("rating") == null ? null : rs.getInt("rating");
                    String body = rs.getString("body");
                    String stratum = CalibrationSample.stratumOf(rating, body);
                    if (fingerprint == null || stratum == null) {
                        continue;
                    }
                    rows.add(new FrameRow(fingerprint, stratum, rating,
                            ReviewTriageRules.tier(rating, body),
                            CalibrationSample.sampleOrderKey(fingerprint)));
                }
            }
        }
        return rows;
    }

    private static Map<String, Label> readLabels() throws Exception {
        JsonNode root = new ObjectMapper().readTree(Files.readString(LABELS));
        Map<String, Label> labels = new HashMap<>();
        for (JsonNode entry : root.path("labels")) {
            String tier = entry.path("tier").asText();
            labels.put(entry.path("reviewIdFingerprint").asText(),
                    new Label("UNCERTAIN".equals(tier) ? null : ReviewTriageTier.valueOf(tier),
                            entry.path("reasonCode").asText(null)));
        }
        return labels;
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required env var: " + name);
        }
        return value;
    }
}
