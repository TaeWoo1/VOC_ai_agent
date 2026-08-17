package com.sellerops.review.triage.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.itemanalysis.eval.EvalMetrics;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.eval.TriageEvalReport.Row;
import com.sellerops.review.triage.eval.TriageEvalReport.TierMetric;
import com.sellerops.review.triage.llm.AdditiveTriageDecision;
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
 * The one reading of the holdout, for one frozen candidate. RUBRIC v2 §8.10.
 *
 * <p><b>A separate file from {@link LlmTriageEvalIT} on purpose.</b> That harness is the one run
 * repeatedly while candidates are developed, and {@code ClassifierBoundaryTest} asserts it has no
 * code path to a holdout row at all — the thing most likely to spend §6.2's single reading early is
 * a harness you re-run every time you change a prompt. This file exists to be run <b>once</b>, and
 * reads as such.
 *
 * <p><b>Gated three ways.</b> {@code RUN_LLM_TRIAGE_EVAL=true}, an API key, and
 * {@code LLM_TRIAGE_SPEND_HOLDOUT=true} — which has no other use and no default. Running it is a
 * sentence someone typed.
 *
 * <p>§8.10's procedure, fixed and committed before this file read anything: 3 independent passes over
 * the 113 holdout rows, each scored under both readings, gated on the worst of the resulting six. The
 * gate is computed on the tier {@link AdditiveTriageDecision} produces — the one a seller would
 * see — never on the raw model output, which is reported separately.
 *
 * <p><b>Whatever it prints is the reported number.</b> §8.10.1: a failure on any bar rejects the
 * candidate and may not be answered by editing a prompt and reading this holdout again.
 */
@EnabledIfEnvironmentVariable(named = "RUN_LLM_TRIAGE_EVAL", matches = "true")
class LlmTriageHoldoutIT {

    private static final Path DIR = Path.of("..", "contracts", "review-eval", "naver", "v2");
    private static final int PASSES = 3;

    private record Label(ReviewTriageTier tier, String reasonCode) {
    }

    private record HoldoutRow(String fingerprint, String stratum, Integer rating, String body) {
    }

    @Test
    void spendTheHoldoutOnceOnTheFrozenCandidate() throws Exception {
        if (Files.exists(DIR.resolve("holdout-spent.json"))) {
            // RUBRIC v2 §12.3. The one reading §6.2 grants was spent on 2026-08-17 and candidate B
            // was rejected on it. §8.10.1 forbids a second, and a sentence in a contract forbidding
            // something is a request — this is the mechanism. See holdout-spent.json.
            System.out.print("\n\n  LlmTriageHoldoutIT: SEALED. contracts/review-eval/naver/v2/"
                    + "holdout-spent.json exists, so this holdout has been read and §8.10.1 gives it\n"
                    + "  no second reading. Candidate C is verified against the fresh sample §13\n"
                    + "  designs, not this one. Nothing was read.\n\n");
            return;
        }
        if (!"true".equals(System.getenv("LLM_TRIAGE_SPEND_HOLDOUT"))) {
            System.out.print("\n\n  LlmTriageHoldoutIT: LLM_TRIAGE_SPEND_HOLDOUT is not set. "
                    + "Nothing was read.\n\n");
            return;
        }

        Map<String, Label> labels = readLabels();
        Set<String> synthetic = readSynthetic();
        List<HoldoutRow> rows = drawHoldoutRows();

        ApiTriageClassifier.Tuning tuning = new ApiTriageClassifier.Tuning(
                !"true".equals(System.getenv("LLM_TRIAGE_OMIT_TEMPERATURE")),
                Integer.parseInt(envOr("LLM_TRIAGE_MAX_OUTPUT_TOKENS", "300")),
                System.getenv("LLM_TRIAGE_REASONING_EFFORT"));
        NaverOnlyClassifierGate gate = new NaverOnlyClassifierGate(new ApiTriageClassifier(
                new JdkLlmHttpClient(), ApiTriageClassifier.Vendor.valueOf(requireEnv("LLM_TRIAGE_VENDOR")),
                requireEnv("LLM_TRIAGE_MODEL"), requireEnv("LLM_TRIAGE_API_KEY"), tuning));

        StringBuilder out = new StringBuilder("""


                ════════════════════════════════════════════════════════════════════════
                  SPENDING THE HOLDOUT — RUBRIC v2 §6.2, §8.10
                  It is read ONCE. Whatever prints below is the reported number, including
                  if it is worse than DEV. Re-tuning after this and reading again is how a
                  holdout stops being one; §8.10.1 requires a new split and a re-labeled
                  sample instead, not a second look.
                ════════════════════════════════════════════════════════════════════════
                """);
        out.append("\n  frozen candidate — ").append(gate.version()).append("\n");
        out.append(String.format("  HOLDOUT rows %d, all labeled %s, passes %d%n", rows.size(),
                rows.stream().allMatch(r -> labels.containsKey(r.fingerprint())), PASSES));
        if (!rows.stream().allMatch(r -> labels.containsKey(r.fingerprint()))) {
            out.append("    ⚠ the draw did not reproduce against labels.json — every number below "
                    + "is suspect\n");
        }
        out.append("""

                  ceiling on everything below (RUBRIC v2 §11.2)
                    These labels were set from a body and a star rating, and so was this candidate's
                    answer. NAVER's export carries 포토/영상 as column 5 of 25 and ReviewRowMapper does
                    not read it, so media_count is 0 on every stored review. This bounds the rule,
                    this candidate, and the two humans who set the labels — by the same amount.
                """);

        List<EvalMetrics.Verdict> primary = new ArrayList<>();
        List<EvalMetrics.Verdict> sensitivity = new ArrayList<>();
        int worstFailures = 0;
        int worstRawDemotions = 0;

        for (int pass = 1; pass <= PASSES; pass++) {
            List<Row> scored = new ArrayList<>();
            List<Row> scoredWithoutSynthetic = new ArrayList<>();
            Map<String, Integer> failures = new LinkedHashMap<>();
            int guardedDemotions = 0;
            int rawDemotions = 0;

            for (HoldoutRow row : rows) {
                Label label = labels.get(row.fingerprint());
                if (label == null || label.tier() == null) {
                    continue; // UNCERTAIN, excluded from every metric by v1 §4.
                }
                ReviewTriageClassifier.Result result = gate.classify(
                        NaverOnlyClassifierGate.PERMITTED_CHANNEL, row.rating(), row.body());
                ReviewTriageTier baseline = ReviewTriageRules.tier(row.rating(), row.body());
                ReviewTriageTier raw = result.status() == ReviewTriageClassifier.Status.OK
                        ? result.tier() : null;
                if (raw == null) {
                    failures.merge(result.status() + " " + result.failureReason(), 1, Integer::sum);
                }
                if (baseline == ReviewTriageTier.NEEDS_ATTENTION && raw != null
                        && raw != ReviewTriageTier.NEEDS_ATTENTION) {
                    rawDemotions++;
                }
                // §8.10: the gate is computed on the tier a seller would see.
                ReviewTriageTier decided = AdditiveTriageDecision.decide(baseline, raw);
                if (baseline == ReviewTriageTier.NEEDS_ATTENTION
                        && decided != ReviewTriageTier.NEEDS_ATTENTION) {
                    guardedDemotions++;
                }
                Row scoredRow = new Row(row.stratum(), "HOLDOUT", row.rating(), decided,
                        label.tier(), label.reasonCode());
                scored.add(scoredRow);
                if (!synthetic.contains(row.fingerprint())) {
                    scoredWithoutSynthetic.add(scoredRow);
                }
            }

            int failed = failures.values().stream().mapToInt(Integer::intValue).sum();
            worstFailures = Math.max(worstFailures, failed);
            worstRawDemotions = Math.max(worstRawDemotions, rawDemotions);
            primary.add(EvalMetrics.evaluate(TriageEvalReport.gateCounts(scored)));
            sensitivity.add(EvalMetrics.evaluate(TriageEvalReport.gateCounts(scoredWithoutSynthetic)));

            out.append(String.format("%n════ PASS %d of %d ════%n", pass, PASSES));
            out.append(String.format("  classification failures %d of %d — the rows still score, at "
                    + "the baseline tier the guard gives them%n", failed, rows.size()));
            failures.forEach((r, c) -> out.append(String.format("    %-48s %4d%n", r, c)));
            out.append(String.format("  §6.3(4) demotions after the guard  %d   (0 by construction)%n",
                    guardedDemotions));
            out.append(String.format("  the model WOULD have demoted        %d   (reported apart, §8.10)%n",
                    rawDemotions));
            out.append(section("HOLDOUT · PRIMARY", scored));
            out.append(section(String.format("HOLDOUT · SENSITIVITY (%d synthetic rows excluded)",
                    scored.size() - scoredWithoutSynthetic.size()), scoredWithoutSynthetic));
        }

        List<EvalMetrics.Verdict> both = new ArrayList<>(primary);
        both.addAll(sensitivity);
        double worstRecall = both.stream().mapToDouble(EvalMetrics.Verdict::recall).min().orElse(0);
        double worstPrecisionLb =
                both.stream().mapToDouble(EvalMetrics.Verdict::precisionLowerBound).min().orElse(0);
        double worstHighFp = both.stream()
                .mapToDouble(EvalMetrics.Verdict::highRatingFalsePositiveRate).max().orElse(1);
        boolean pass = worstRecall >= 0.30 && worstPrecisionLb >= 0.80 && worstHighFp <= 0.05;

        out.append(String.format("""
                %n════════════════════════════════════════════════════════════════════════
                  FINAL HOLDOUT GATE — worst of %d passes × both readings (§8.10)
                    recall              worst %.3f   bar ≥ 0.30   %s
                    precision 95%% low   worst %.3f   bar ≥ 0.80   %s
                    4–5★ FP rate        worst %.3f   bar ≤ 0.05   %s
                    failures            worst %d
                    model raw demotions worst %d
                  descriptive — recall PRIMARY %s
                               recall SENSITIVITY %s

                  VERDICT: %s
                ════════════════════════════════════════════════════════════════════════
                  This holdout is now spent. §8.10.1: it is never read again — not after a
                  prompt edit, not for a later candidate, not as a sanity check.
                %n""",
                PASSES, worstRecall, worstRecall >= 0.30 ? "PASS" : "FAIL",
                worstPrecisionLb, worstPrecisionLb >= 0.80 ? "PASS" : "FAIL",
                worstHighFp, worstHighFp <= 0.05 ? "PASS" : "FAIL", worstFailures, worstRawDemotions,
                primary.stream().map(v -> String.format("%.3f", v.recall())).toList(),
                sensitivity.stream().map(v -> String.format("%.3f", v.recall())).toList(),
                pass ? "PASS — every bar cleared on every one of the six readings"
                     : "REJECTED — §8.10.1 applies: record as measured, do not re-read this holdout"));

        System.out.print(out);
    }

    private static String section(String name, List<Row> rows) {
        int[][] matrix = TriageEvalReport.confusion(rows);
        StringBuilder out = new StringBuilder(String.format("%n  ── %s ── %d scored%n", name, rows.size()));
        out.append("    confusion (rows = human, columns = final decision)\n");
        out.append("                    확인 필요   지켜보기      참고\n");
        String[] names = {"확인 필요", "지켜보기", "  참고  "};
        for (int i = 0; i < 3; i++) {
            out.append(String.format("      %-9s %8d %9d %9d%n", names[i], matrix[i][0], matrix[i][1],
                    matrix[i][2]));
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
                %n    gate counts
                      tp=%d fp=%d fn=%d tn=%d
                      precision=%.3f (95%% lower bound %.3f)  recall=%.3f
                      high-rating false-positive rate=%.3f over %d high-rated NO_ACTION reviews%n""",
                counts.truePositives(), counts.falsePositives(), counts.falseNegatives(),
                counts.trueNegatives(), verdict.precision(), verdict.precisionLowerBound(),
                verdict.recall(), verdict.highRatingFalsePositiveRate(), counts.highRatingNoAction()));
        Map<String, Integer> byReason = TriageEvalReport.missedByReason(rows);
        out.append(String.format("%n    what the candidate missed (%d reviews a human called 확인 필요)%n",
                byReason.values().stream().mapToInt(Integer::intValue).sum()));
        byReason.forEach((r, c) -> out.append(String.format("      %-26s %4d%n", r, c)));
        out.append("      by rating: ").append(TriageEvalReport.missedByRating(rows)).append('\n');
        return out.toString();
    }

    /** The §4 draw, re-derived, then narrowed to the other half. */
    private static List<HoldoutRow> drawHoldoutRows() throws Exception {
        Map<String, List<HoldoutRow>> byStratum = new LinkedHashMap<>();
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
                            .add(new HoldoutRow(fingerprint, stratum, rating, body));
                }
            }
        }
        List<HoldoutRow> holdout = new ArrayList<>();
        for (String stratum : CalibrationSample.STRATA) {
            List<HoldoutRow> pool = new ArrayList<>(byStratum.getOrDefault(stratum, List.of()));
            pool.sort(Comparator.comparing(r -> order.get(r.fingerprint())));
            int take = Math.min(pool.size(), CalibrationSample.ALLOCATION.get(stratum));
            for (HoldoutRow row : pool.subList(0, take)) {
                if (!"DEV".equals(CalibrationSample.splitOf(row.fingerprint()))) {
                    holdout.add(row);
                }
            }
        }
        return holdout;
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

    private static String envOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required env var: " + name);
        }
        return value;
    }
}
