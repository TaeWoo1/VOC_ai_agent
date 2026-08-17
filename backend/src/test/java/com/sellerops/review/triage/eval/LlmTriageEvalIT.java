package com.sellerops.review.triage.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.itemanalysis.eval.EvalMetrics;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.TriageReasonCode;
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
 * Measures a candidate LLM classifier against the 220-row gold set — <b>all of it</b>.
 *
 * <h2>What changed on 2026-08-17, and why it is not a relaxation</h2>
 *
 * <p>This harness used to score {@code DEV} only, and {@code ClassifierBoundaryTest} asserted it had
 * no code path to a holdout row at all. That was right while the holdout was unspent. It has since
 * been spent: candidate B was read against it once, rejected on precision, and RUBRIC v2 §12 makes
 * <b>all 220 rows development evidence</b> as a result.
 *
 * <p>So the constraint moves rather than loosens. This harness may read every one of the 220 and may
 * finally verify <b>nothing</b> — §12.1: every number it prints is in-sample by construction, because
 * the rows' errors are read while the candidate is being written. The bars are still printed, and
 * they are diagnostics here, not evidence for `v1` §5. A candidate is verified against the fresh
 * sample §13 designs, in a harness that does not exist yet because that sample does not exist yet.
 *
 * <p>The §6.1 split is still computed and still printed per row, for the one thing §12.2 keeps it
 * for: it records which rows candidate B had never been shown when it was frozen.
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
 * <p><b>It cannot reach the fresh sample.</b> One corpus directory constant, pointing at
 * {@code naver/v2}; no {@code SPEND_HOLDOUT} flag; asserted by {@code ClassifierBoundaryTest}. The
 * thing most likely to spend a single-reading holdout early is a harness you re-run on every prompt
 * edit, and this is that harness.
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

    /** {@code split} is provenance only (§12.2) — it selects nothing. */
    private record CorpusRow(String fingerprint, String stratum, String split, Integer rating,
                             String body) {
    }

    @Test
    void measureTheCandidateOnTheDevelopmentCorpus() throws Exception {
        Map<String, Label> labels = readLabels();
        Set<String> synthetic = readSynthetic();

        List<CorpusRow> drawn = new ArrayList<>(drawCorpusRows());
        StringBuilder out = new StringBuilder();

        String vendor = requireEnv("LLM_TRIAGE_VENDOR");
        String model = requireEnv("LLM_TRIAGE_MODEL");
        // Every request knob is read here and none is inferred, because all of them are part of
        // version() and therefore part of what the §8.6 change log records. A knob that changed the
        // request without changing the version would let two candidates be measured under one name.
        ApiTriageClassifier.Tuning tuning = new ApiTriageClassifier.Tuning(
                !"true".equals(System.getenv("LLM_TRIAGE_OMIT_TEMPERATURE")),
                Integer.parseInt(envOr("LLM_TRIAGE_MAX_OUTPUT_TOKENS", "300")),
                System.getenv("LLM_TRIAGE_REASONING_EFFORT"));
        NaverOnlyClassifierGate gate = new NaverOnlyClassifierGate(new ApiTriageClassifier(
                new JdkLlmHttpClient(), ApiTriageClassifier.Vendor.valueOf(vendor), model,
                requireEnv("LLM_TRIAGE_API_KEY"), tuning));

        // A bounded wiring check, so the first contact with a new vendor costs a few calls instead of
        // 107. It can never be mistaken for a result: the run is stamped WIRING CHECK, and §8.6's
        // change log takes a row only from a full DEV pass. A truncated run that reported a recall
        // would be reporting recall over whichever rows happened to sort first.
        int limit = Integer.parseInt(envOr("LLM_TRIAGE_LIMIT", "0"));
        boolean bounded = limit > 0 && limit < drawn.size();
        if (bounded) {
            drawn = drawn.subList(0, limit);
        }

        out.append("\n\nreview-triage calibration — ").append(gate.version()).append("\n\n");
        out.append("""
                  ⚠ DEVELOPMENT CORPUS — RUBRIC v2 §12.1. The v2 holdout was spent on candidate B
                    and all 220 rows are development evidence now. Every number below is IN-SAMPLE
                    by construction: these rows' errors are read while the candidate is written.
                    The bars are printed as diagnostics. They are not evidence for `v1` §5, and no
                    candidate is verified here — §13's fresh sample is where that happens.

                """);
        if (bounded) {
            out.append(String.format("""
                      ⚠⚠ WIRING CHECK, NOT A RESULT — %d of the corpus rows, taken in draw order.
                         Nothing below is a candidate score and none of it may enter the §8.6
                         change log. Unset LLM_TRIAGE_LIMIT for a real pass.

                    """, limit));
        }
        out.append(String.format("  corpus rows drawn %d, all labeled %s%n", drawn.size(),
                drawn.stream().allMatch(r -> labels.containsKey(r.fingerprint()))));
        if (!drawn.stream().allMatch(r -> labels.containsKey(r.fingerprint()))) {
            // The draw and the gold set disagree, so nothing below means anything. Said loudly
            // rather than scored around.
            out.append("    ⚠ the draw did not reproduce against labels.json — every number below "
                    + "is suspect\n");
        }

        int passes = Integer.parseInt(envOr("LLM_TRIAGE_PASSES", bounded ? "1" : "3"));
        out.append(String.format("  passes %d — RUBRIC v2 §8.7 gates on the WORST observed, never the best%n",
                passes));

        List<EvalMetrics.Verdict> verdicts = new ArrayList<>();
        List<EvalMetrics.Counts> allCounts = new ArrayList<>();
        int worstFailures = 0;
        List<String> answers = new ArrayList<>();

        for (int pass = 1; pass <= passes; pass++) {
            List<Row> rows = new ArrayList<>();
            List<Row> rowsWithoutSynthetic = new ArrayList<>();
            Map<String, Integer> failures = new LinkedHashMap<>();
            int reasonAgree = 0;
            int reasonScored = 0;
            int demotions = 0;
            int rawDemotions = 0;
            int crossingRows = 0;
            int crossingCaught = 0;

            for (CorpusRow row : drawn) {
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
                    // Counted, never silently skipped. But the row is still SCORED, because the
                    // guard gives it the baseline tier and that is what production would show — a
                    // harness that dropped failed rows would measure a system that skips reviews.
                    failures.merge(result.status() + " " + result.failureReason(), 1, Integer::sum);
                }

                // The gate scores the FINAL decision, which is what a seller would see. Scoring the
                // raw model output would measure something the product does not contain.
                ReviewTriageTier decided = AdditiveTriageDecision.decide(baseline, raw);
                if (baseline == ReviewTriageTier.NEEDS_ATTENTION
                        && decided != ReviewTriageTier.NEEDS_ATTENTION) {
                    demotions++;
                }
                if (baseline == ReviewTriageTier.NEEDS_ATTENTION && raw != null
                        && raw != ReviewTriageTier.NEEDS_ATTENTION) {
                    // What the model WOULD have done without the guard. Descriptive, and the honest
                    // way to say whether prompt/v2 fixed the behaviour or the guard is carrying it.
                    rawDemotions++;
                }

                Row scored = new Row(row.stratum(), row.split(), row.rating(), decided,
                        label.tier(), label.reasonCode());
                rows.add(scored);
                if (!synthetic.contains(row.fingerprint())) {
                    rowsWithoutSynthetic.add(scored);
                }
                if (label.reasonCode() != null && result.reasonCode() != null) {
                    reasonScored++;
                    if (label.reasonCode().equals(result.reasonCode())) {
                        reasonAgree++;
                    }
                }
                if (crosses(label)) {
                    crossingRows++;
                    if (decided == label.tier()) {
                        crossingCaught++;
                    }
                }
                // §8.12: every pass, not only the first. An evaluation that reports "3 false
                // positives" and cannot say which three has measured the bar and not the failure.
                boolean goldPositive = label.tier() == ReviewTriageTier.NEEDS_ATTENTION;
                boolean calledPositive = decided == ReviewTriageTier.NEEDS_ATTENTION;
                answers.add(String.join(",", String.valueOf(pass), row.fingerprint(), row.stratum(),
                        row.split(), String.valueOf(row.rating()), baseline.name(),
                        raw == null ? "FAILED" : raw.name(), decided.name(), label.tier().name(),
                        goldPositive == calledPositive ? (goldPositive ? "TP" : "TN")
                                : (calledPositive ? "FP" : "FN"),
                        String.valueOf(result.reasonCode()), String.valueOf(label.reasonCode())));
            }

            int failed = failures.values().stream().mapToInt(Integer::intValue).sum();
            worstFailures = Math.max(worstFailures, failed);
            EvalMetrics.Counts counts = TriageEvalReport.gateCounts(rows);
            allCounts.add(counts);
            verdicts.add(EvalMetrics.evaluate(counts));

            out.append(String.format("%n════ PASS %d of %d ════%n", pass, passes));
            out.append(String.format("  classification failures %d of %d — the rows still score, at "
                    + "the baseline tier the guard gives them%n", failed, drawn.size()));
            failures.forEach((r, c) -> out.append(String.format("    %-48s %4d%n", r, c)));
            out.append(String.format("  §6.3(4) demotions after the guard  %d   (must be 0 by construction)%n",
                    demotions));
            out.append(String.format("  the model WOULD have demoted        %d   (descriptive: is prompt/v2 "
                    + "working, or is the guard carrying it?)%n", rawDemotions));
            out.append(String.format("  reasonCode agreement %d/%d · gold crosses §3.1's column on %d rows, "
                    + "tier matched on %d%n", reasonAgree, reasonScored, crossingRows, crossingCaught));
            out.append(section("DEV · PRIMARY", rows));
            out.append(section(String.format("DEV · SENSITIVITY (%d synthetic rows excluded)",
                    rows.size() - rowsWithoutSynthetic.size()), rowsWithoutSynthetic));
        }

        // §8.12. Written to build/, never committed: it pairs fingerprints with content-derived
        // judgments and §5 governs what may enter the repository.
        Files.writeString(Path.of("build", "llm-triage-answers.csv"),
                "pass,fingerprint,stratum,split,rating,rulesV1,modelRaw,finalDecision,gold,outcome,"
                        + "candidateReason,goldReason\n" + String.join("\n", answers) + "\n");

        // ── the gate, §8.7 ───────────────────────────────────────────────────────────────────
        double worstRecall = verdicts.stream().mapToDouble(EvalMetrics.Verdict::recall).min().orElse(0);
        double worstPrecisionLb =
                verdicts.stream().mapToDouble(EvalMetrics.Verdict::precisionLowerBound).min().orElse(0);
        double worstHighFp = verdicts.stream()
                .mapToDouble(EvalMetrics.Verdict::highRatingFalsePositiveRate).max().orElse(1);
        out.append(String.format("""
                %n════════════════════════════════════════════════════════════════════════
                  THE GATE — worst of %d passes (RUBRIC v2 §8.7)
                    recall              worst %.3f   bar ≥ 0.30   %s
                    precision 95%% low   worst %.3f   bar ≥ 0.80   %s
                    4–5★ FP rate        worst %.3f   bar ≤ 0.05   %s
                    failures            worst %d
                  descriptive spread — recall %s
                  A best-of reading of these passes is not a result. The worst is the number.
                ════════════════════════════════════════════════════════════════════════
                %n""",
                passes, worstRecall, worstRecall >= 0.30 ? "PASS" : "FAIL",
                worstPrecisionLb, worstPrecisionLb >= 0.80 ? "PASS" : "FAIL",
                worstHighFp, worstHighFp <= 0.05 ? "PASS" : "FAIL", worstFailures,
                verdicts.stream().map(v -> String.format("%.3f", v.recall())).toList()));

        out.append("""
                  §12.1: in-sample. Nothing above verifies a candidate. The fresh sample §13 designs
                  does not exist yet, and until it has been read and passed, ReviewTriageRules stays
                  what every seller sees.
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
        TriageEvalReport.PrecisionPower power = TriageEvalReport.precisionPower(counts, 0.80);
        out.append(String.format("""
                %n    how much evidence the precision bar has here (§13.1, descriptive)
                      predicted positives %d — at that n the 0.80 bar tolerates at most %d false
                      positive(s); this candidate's observed precision would clear it at n=%d%n""",
                power.predictedPositives(), power.maxFalsePositives(), power.nForObservedToPass()));

        Map<String, Integer> byReason = TriageEvalReport.missedByReason(rows);
        out.append(String.format("%n    what the candidate missed — FN (%d reviews a human called 확인 필요)%n",
                byReason.values().stream().mapToInt(Integer::intValue).sum()));
        byReason.forEach((reason, count) -> out.append(String.format("      %-26s %4d%n", reason, count)));
        out.append("      by rating: ").append(TriageEvalReport.missedByRating(rows)).append('\n');

        // §8.12. Precision is the bar candidate B failed, so its taxonomy is printed too.
        Map<String, Integer> fpByReason = TriageEvalReport.falsePositivesByReason(rows);
        out.append(String.format("%n    what the candidate over-flagged — FP (%d reviews a human did not "
                        + "call 확인 필요), by the reason the human gave%n",
                fpByReason.values().stream().mapToInt(Integer::intValue).sum()));
        fpByReason.forEach((reason, count) -> out.append(String.format("      %-26s %4d%n", reason, count)));
        out.append("      by rating: ").append(TriageEvalReport.falsePositivesByRating(rows)).append('\n');
        return out.toString();
    }

    /**
     * The §4 draw, re-derived — all 220 rows, both halves (§12).
     *
     * <p>Re-derived rather than read from a list, for the reason §4.3 gives: if the draw were not
     * reproducible, the labeled set and this set would silently differ. The integrity line above
     * reports whether every drawn row carries a gold label, which is what would catch it.
     *
     * <p>{@link CalibrationSample#splitOf} is still called, and its answer is carried onto every row
     * and printed. It selects nothing — §12.2 keeps it as the record of which rows candidate B had
     * never been shown.
     */
    private static List<CorpusRow> drawCorpusRows() throws Exception {
        Map<String, List<CorpusRow>> byStratum = new LinkedHashMap<>();
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
                            .add(new CorpusRow(fingerprint, stratum,
                                    CalibrationSample.splitOf(fingerprint), rating, body));
                }
            }
        }
        List<CorpusRow> corpus = new ArrayList<>();
        for (String stratum : CalibrationSample.STRATA) {
            List<CorpusRow> pool = new ArrayList<>(byStratum.getOrDefault(stratum, List.of()));
            pool.sort(Comparator.comparing(r -> order.get(r.fingerprint())));
            int take = Math.min(pool.size(), CalibrationSample.ALLOCATION.get(stratum));
            corpus.addAll(pool.subList(0, take));
        }
        return corpus;
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
