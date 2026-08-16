package com.sellerops.review.triage.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.itemanalysis.eval.EvalMetrics;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.TriageReasonCode;
import com.sellerops.review.triage.eval.TriageEvalReport.Row;
import com.sellerops.review.triage.eval.TriageEvalReport.TierMetric;
import com.sellerops.review.triage.llm.ApiTriageClassifier;
import com.sellerops.review.triage.llm.JdkLlmHttpClient;
import com.sellerops.review.triage.llm.NaverOnlyClassifierGate;
import com.sellerops.review.triage.llm.ReviewTriageClassifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Measures a candidate LLM classifier against the same 220-row gold set, on {@code DEV} only.
 *
 * <p><b>Gated twice over.</b> {@code RUN_LLM_TRIAGE_EVAL=true} plus a database, and separately an
 * API key — because unlike {@code ReviewTriageEvalIT} this one <b>sends real customer review text to
 * a third party</b> under {@code contracts/review-eval/naver/v2/RUBRIC.md} §8.3. It never runs in
 * CI, never runs by accident, and prints counts and rates only.
 *
 * <pre>
 *   RUN_LLM_TRIAGE_EVAL=true LLM_TRIAGE_VENDOR=ANTHROPIC LLM_TRIAGE_MODEL=… LLM_TRIAGE_API_KEY=…
 *   REVIEW_EVAL_JDBC_URL=… REVIEW_EVAL_DB_USER=… ./gradlew test --tests '*LlmTriageEvalIT*' --info
 * </pre>
 *
 * <p><b>{@code HOLDOUT} is never read here.</b> Not behind a flag, not with an environment variable —
 * this harness has no code path that scores a holdout row, because §6.2's "read once" is spent by
 * the final candidate and a prompt-iteration harness is exactly the thing that would spend it early.
 * The holdout reading is {@code ReviewTriageEvalIT}'s, after a freeze.
 *
 * <p><b>Every run belongs in the §8.6 change log</b> (`docs/slices/llm-triage-classifier-v1.md`),
 * including the ones that scored badly. A candidate that needed six passes to clear the bars is a
 * different object from one that cleared them on the first, and the log is what lets a reader tell.
 */
@EnabledIfEnvironmentVariable(named = "RUN_LLM_TRIAGE_EVAL", matches = "true")
class LlmTriageEvalIT {

    private static final Path DIR = Path.of("..", "contracts", "review-eval", "naver", "v2");

    private record Label(ReviewTriageTier tier, String reasonCode) {
    }

    private record DevRow(String fingerprint, String stratum, Integer rating, String body) {
    }

    @Test
    void measureTheCandidateOnDevOnly() throws Exception {
        Map<String, Label> labels = readLabels();
        Set<String> synthetic = readSynthetic();

        List<DevRow> drawn = drawDevRows();
        StringBuilder out = new StringBuilder();

        String vendor = requireEnv("LLM_TRIAGE_VENDOR");
        String model = requireEnv("LLM_TRIAGE_MODEL");
        // Some models reject any temperature but their own default and answer a pinned one with a
        // 400 on every row. Explicit rather than retried-around: a retry that changed the request
        // would measure two candidates under one name, and the flag is part of version() so the
        // §8.6 change log can say which was run.
        boolean pinTemperature = !"true".equals(System.getenv("LLM_TRIAGE_OMIT_TEMPERATURE"));
        NaverOnlyClassifierGate gate = new NaverOnlyClassifierGate(new ApiTriageClassifier(
                new JdkLlmHttpClient(), ApiTriageClassifier.Vendor.valueOf(vendor), model,
                requireEnv("LLM_TRIAGE_API_KEY"), pinTemperature));

        out.append("\n\nreview-triage calibration — ").append(gate.version()).append("\n\n");
        out.append(String.format("  DEV rows drawn %d, all labeled %s%n", drawn.size(),
                drawn.stream().allMatch(r -> labels.containsKey(r.fingerprint()))));
        if (!drawn.stream().allMatch(r -> labels.containsKey(r.fingerprint()))) {
            // The draw and the gold set disagree, so nothing below means anything. Said loudly
            // rather than scored around.
            out.append("    ⚠ the draw did not reproduce against labels.json — every number below "
                    + "is suspect\n");
        }

        List<Row> rows = new ArrayList<>();
        List<Row> rowsWithoutSynthetic = new ArrayList<>();
        Map<String, Integer> failures = new LinkedHashMap<>();
        int reasonAgree = 0;
        int reasonScored = 0;
        int crossingRows = 0;
        int crossingCaught = 0;

        for (DevRow row : drawn) {
            Label label = labels.get(row.fingerprint());
            if (label == null || label.tier() == null) {
                continue; // UNCERTAIN, excluded from every metric by v1 §4.
            }
            ReviewTriageClassifier.Result result =
                    gate.classify(NaverOnlyClassifierGate.PERMITTED_CHANNEL, row.rating(), row.body());
            if (result.status() != ReviewTriageClassifier.Status.OK) {
                // Counted, never silently skipped: a run that scored only the rows that happened to
                // succeed would report the model's accuracy on its good days.
                failures.merge(result.status() + " " + result.failureReason(), 1, Integer::sum);
                continue;
            }
            Row scored = new Row(row.stratum(), "DEV", row.rating(), result.tier(),
                    label.tier(), label.reasonCode());
            rows.add(scored);
            if (!synthetic.contains(row.fingerprint())) {
                rowsWithoutSynthetic.add(scored);
            }
            if (label.reasonCode() != null) {
                reasonScored++;
                if (label.reasonCode().equals(result.reasonCode())) {
                    reasonAgree++;
                }
            }
            if (crosses(label)) {
                // The 16 gold rows whose reason sits on the other side of §3.1's description column.
                // Tracked separately because they are the rows where the rubric itself is unclear,
                // and a candidate should not be judged mainly on them.
                crossingRows++;
                if (result.tier() == label.tier()) {
                    crossingCaught++;
                }
            }
        }

        out.append(String.format("%n  classification failures %d of %d attempted%n",
                failures.values().stream().mapToInt(Integer::intValue).sum(), drawn.size()));
        failures.forEach((reason, count) -> out.append(String.format("    %-48s %4d%n", reason, count)));
        if (!failures.isEmpty()) {
            out.append("    ⚠ every metric below is over the rows that SUCCEEDED. Quote this rate "
                    + "beside them.\n");
        }

        out.append("""

                  ceiling on everything below (RUBRIC v2 §11.2)
                    These labels were set from a body and a star rating, and so was this candidate's
                    answer. NAVER's export carries 포토/영상 as column 5 of 25 and ReviewRowMapper does
                    not read it, so media_count is 0 on every stored review. This bounds rules-v1,
                    this candidate, and the two humans who set the labels — by the same amount.
                """);

        out.append(section("DEV · PRIMARY", rows));
        out.append(section(String.format("DEV · SENSITIVITY (%d synthetic rows excluded)",
                rows.size() - rowsWithoutSynthetic.size()), rowsWithoutSynthetic));

        out.append(String.format("""
                %n  descriptive, and gating nothing (RUBRIC v2 §3.1)
                    reasonCode agreement with gold       %d/%d
                    rows where gold crosses §3.1's column %d, tier matched on %d of them
                    A crossing row is one the RUBRIC itself does not decide cleanly. They are
                    reported apart so a candidate is not judged mainly on the rubric's own gaps.
                %n""", reasonAgree, reasonScored, crossingRows, crossingCaught));

        out.append("""
                  HOLDOUT was not read, and this harness cannot read it. §6.2 spends it once, on the
                  frozen candidate, through ReviewTriageEvalIT.
                """);
        System.out.print(out);
    }

    /** §3.1's description column, crossed. Descriptive — see {@code TriageReasonCode}. */
    private static boolean crosses(Label label) {
        return TriageReasonCode.parse(label.reasonCode())
                .map(code -> code.actionable() != (label.tier() == ReviewTriageTier.NEEDS_ATTENTION))
                .orElse(false);
    }

    private static String section(String name, List<Row> rows) {
        int[][] matrix = TriageEvalReport.confusion(rows);
        StringBuilder out = new StringBuilder(String.format("%n  ── %s ── %d scored%n", name, rows.size()));
        out.append("    confusion (rows = human, columns = model)\n");
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
                %n    PRIMARY GATE — NEEDS_ATTENTION vs NO_ACTION (v1 §5)
                      tp=%d fp=%d fn=%d tn=%d
                      precision=%.3f (95%% lower bound %.3f)  recall=%.3f
                      high-rating false-positive rate=%.3f over %d high-rated NO_ACTION reviews
                      pass=%s   %s%n""",
                counts.truePositives(), counts.falsePositives(), counts.falseNegatives(),
                counts.trueNegatives(), verdict.precision(), verdict.precisionLowerBound(),
                verdict.recall(), verdict.highRatingFalsePositiveRate(), counts.highRatingNoAction(),
                verdict.pass(), verdict.reason()));
        Map<String, Integer> byReason = TriageEvalReport.missedByReason(rows);
        out.append(String.format("%n    what the candidate missed (%d reviews a human called 확인 필요)%n",
                byReason.values().stream().mapToInt(Integer::intValue).sum()));
        byReason.forEach((reason, count) -> out.append(String.format("      %-26s %4d%n", reason, count)));
        out.append("      by rating: ").append(TriageEvalReport.missedByRating(rows)).append('\n');
        return out.toString();
    }

    /**
     * The §4 draw, re-derived, then narrowed to {@code DEV}.
     *
     * <p>Re-derived rather than read from a list, for the reason §4.3 gives: if the draw were not
     * reproducible, the labeled set and this set would silently differ. The integrity line above
     * reports whether every drawn row carries a gold label, which is what would catch it.
     */
    private static List<DevRow> drawDevRows() throws Exception {
        Map<String, List<DevRow>> byStratum = new LinkedHashMap<>();
        Map<String, String> order = new HashMap<>();
        try (Connection db = DriverManager.getConnection(
                requireEnv("REVIEW_EVAL_JDBC_URL"), requireEnv("REVIEW_EVAL_DB_USER"),
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
                    order.put(fingerprint, CalibrationSample.sampleOrderKey(fingerprint));
                    byStratum.computeIfAbsent(stratum, k -> new ArrayList<>())
                            .add(new DevRow(fingerprint, stratum, rating, body));
                }
            }
        }
        List<DevRow> dev = new ArrayList<>();
        for (String stratum : CalibrationSample.STRATA) {
            List<DevRow> pool = new ArrayList<>(byStratum.getOrDefault(stratum, List.of()));
            pool.sort(Comparator.comparing(r -> order.get(r.fingerprint())));
            int take = Math.min(pool.size(), CalibrationSample.ALLOCATION.get(stratum));
            for (DevRow row : pool.subList(0, take)) {
                if ("DEV".equals(CalibrationSample.splitOf(row.fingerprint()))) {
                    dev.add(row);
                }
            }
        }
        return dev;
    }

    private static Map<String, Label> readLabels() throws Exception {
        JsonNode root = new ObjectMapper().readTree(Files.readString(DIR.resolve("labels.json")));
        Map<String, Label> labels = new HashMap<>();
        for (JsonNode entry : root.path("labels")) {
            String tier = entry.path("tier").asText();
            labels.put(entry.path("reviewIdFingerprint").asText(),
                    new Label("UNCERTAIN".equals(tier) ? null : ReviewTriageTier.valueOf(tier),
                            entry.path("reasonCode").asText(null)));
        }
        return labels;
    }

    private static Set<String> readSynthetic() throws Exception {
        JsonNode root = new ObjectMapper().readTree(Files.readString(DIR.resolve("synthetic-rows.json")));
        Set<String> fingerprints = new HashSet<>();
        for (JsonNode entry : root.path("rows")) {
            fingerprints.add(entry.path("reviewIdFingerprint").asText());
        }
        return fingerprints;
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required env var: " + name);
        }
        return value;
    }
}
