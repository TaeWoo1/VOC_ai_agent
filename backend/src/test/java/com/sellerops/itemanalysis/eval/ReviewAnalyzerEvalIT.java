package com.sellerops.itemanalysis.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.itemanalysis.InboxItemAnalyzer;
import com.sellerops.itemanalysis.InboxItemAnalyzer.SourceItem;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.itemanalysis.eval.EvalMetrics.Counts;
import com.sellerops.itemanalysis.eval.EvalMetrics.Verdict;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Measures the CURRENT analyzer against human labels, so a future detector has a bar to clear
 * rather than an assertion to make.
 *
 * <p><b>Gated and local.</b> It reads real review bodies out of a local database, so it never runs
 * in CI and never runs by accident: set {@code RUN_REVIEW_EVAL=true} plus
 * {@code REVIEW_EVAL_JDBC_URL}, {@code REVIEW_EVAL_DB_USER}, {@code REVIEW_EVAL_DB_PASSWORD} and
 * {@code REVIEW_EVAL_ORG_ID}. Nothing is written — the connection is read-only in intent and the
 * harness issues one SELECT.
 *
 * <p><b>Output is counts only.</b> No body, no raw {@code 리뷰글번호}, no fingerprint, no product, no
 * seller identity ever reaches stdout. That is not decoration: the whole reason this test exists
 * off to one side is that the data it reads may not leave the machine, and a report is the easiest
 * way for it to leak. Run with {@code --info} to see the report (Gradle captures stdout).
 *
 * <p>The seed is {@code contracts/review-eval/naver/v1/labels.json}, keyed by
 * {@link ReviewIdFingerprint} so the committed file holds no customer text. It ships EMPTY, which is
 * the honest state until a labeling session runs — and {@link EvalMetrics} refuses to return a
 * verdict below the rubric's adequacy floor, so an empty or thin seed reports "cannot decide"
 * instead of a number someone might quote.
 */
@EnabledIfEnvironmentVariable(named = "RUN_REVIEW_EVAL", matches = "true")
class ReviewAnalyzerEvalIT {

    private static final Path LABELS =
            Path.of("..", "contracts", "review-eval", "naver", "v1", "labels.json");

    /** How the analyzer says "this needs a look" today. A future detector supplies its own. */
    private static boolean flags(InboxItemAnalyzer analyzer, SourceItem item) {
        return "HIGH".equals(analyzer.analyze(item).urgency());
    }

    @Test
    void measureTheCurrentAnalyzerAgainstTheLabelledSeed() throws Exception {
        Map<String, String> labels = readLabels();
        InboxItemAnalyzer analyzer = new RuleBasedInboxItemAnalyzer();

        int tp = 0;
        int fp = 0;
        int fn = 0;
        int tn = 0;
        int uncertain = 0;
        int highRatingFp = 0;
        int highRatingNoAction = 0;
        int unmatched = 0;

        try (Connection db = DriverManager.getConnection(
                requireEnv("REVIEW_EVAL_JDBC_URL"),
                requireEnv("REVIEW_EVAL_DB_USER"),
                System.getenv("REVIEW_EVAL_DB_PASSWORD"));
             PreparedStatement ps = db.prepareStatement(
                     "select external_id, body, rating, is_negative from reviews "
                             + "where org_id = ? and external_id is not null")) {
            db.setReadOnly(true);
            ps.setObject(1, UUID.fromString(requireEnv("REVIEW_EVAL_ORG_ID")));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String label = labels.get(ReviewIdFingerprint.of(rs.getString("external_id")));
                    if (label == null) {
                        unmatched++;
                        continue;
                    }
                    if ("UNCERTAIN".equals(label)) {
                        uncertain++;
                        continue;
                    }
                    Integer rating = rs.getObject("rating") == null ? null : rs.getInt("rating");
                    boolean flagged = flags(analyzer, new SourceItem("REVIEW", UUID.randomUUID(),
                            rs.getString("body"), rating, null, rs.getBoolean("is_negative")));
                    boolean needsLook = "NEEDS_LOOK".equals(label);

                    if (needsLook && flagged) {
                        tp++;
                    } else if (needsLook) {
                        fn++;
                    } else if (flagged) {
                        fp++;
                    } else {
                        tn++;
                    }
                    // The specific harm the rubric gates on, tracked separately from aggregate
                    // precision: a 4–5★ review a human said needed nothing, that the detector flagged.
                    if (!needsLook && rating != null && rating >= 4) {
                        highRatingNoAction++;
                        if (flagged) {
                            highRatingFp++;
                        }
                    }
                }
            }
        }

        Counts counts = new Counts(tp, fp, fn, tn, uncertain, highRatingFp, highRatingNoAction);
        Verdict verdict = EvalMetrics.evaluate(counts);

        // Counts and rates only. Never a body, never an id, never a fingerprint.
        System.out.printf("""

                review-analyzer eval — analyzer=%s
                  labeled=%d (needs-look=%d) uncertain=%d unmatched-in-db=%d
                  tp=%d fp=%d fn=%d tn=%d
                  precision=%.3f (95%% lower bound %.3f)  recall=%.3f
                  high-rating false-positive rate=%.3f over %d high-rated NO_ACTION reviews
                  adequate=%s  pass=%s
                  %s
                %n""",
                analyzer.version(), counts.labeled(), counts.positives(), uncertain, unmatched,
                tp, fp, fn, tn,
                verdict.precision(), verdict.precisionLowerBound(), verdict.recall(),
                verdict.highRatingFalsePositiveRate(), highRatingNoAction,
                verdict.adequate(), verdict.pass(), verdict.reason());

        // Deliberately does NOT assert pass(). rules-v1 is expected to fail on recall — that is the
        // finding, not a broken build. Turning the baseline red would mean the only way to get a
        // green suite is to stop measuring.
    }

    private static Map<String, String> readLabels() throws Exception {
        JsonNode root = new ObjectMapper().readTree(Files.readString(LABELS));
        Map<String, String> labels = new HashMap<>();
        for (JsonNode entry : root.path("labels")) {
            labels.put(entry.path("reviewIdFingerprint").asText(), entry.path("label").asText());
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
