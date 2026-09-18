package com.sellerops.knowledge.quality;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.OperationsCaseRules;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.common.ReviewIdFingerprint;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * <b>Review Disposition Quality v1</b> — what the shipped rules decide about a real review corpus, scored against the
 * human labels of {@code contracts/review-eval/naver/v2}.
 *
 * <p><b>The metric that matters is the false AUTO_RESOLVED</b>: a review a person said needs attention, that
 * Reviewnary closed on its own. Everything else here is context for it. There is deliberately no threshold that a
 * higher auto-close rate would improve — closing more is not better, and a harness that rewarded it would be pointing
 * the product at the wrong number.
 *
 * <p><b>Gated and local</b>, exactly like the triage evals it sits beside: it reads real review bodies from a local
 * database, so it never runs in CI and never runs by accident. Set {@code RUN_REVIEW_DISPOSITION=true} plus
 * {@code REVIEW_EVAL_JDBC_URL}, {@code REVIEW_EVAL_DB_USER} and {@code REVIEW_EVAL_DB_PASSWORD}. One read-only SELECT;
 * nothing is written, no model is called, and no body, rating pair or fingerprint reaches stdout — counts only.
 *
 * <p><b>What the agent can still change, and what it cannot.</b> Only the rows below marked «investigate» reach the
 * investigator at all; the rest are decided here and never seen by a model. Of those, {@code CaseDecisionGuard} lets
 * a model close one only when it recommends NO_ACTION with better than LOW confidence and no customer is waiting — so
 * the agent's contribution to a false close is bounded by the «investigate» count, and is measured with a model by
 * {@code ReviewDispositionAgentIT}.
 */
@EnabledIfEnvironmentVariable(named = "RUN_REVIEW_DISPOSITION", matches = "true")
class ReviewDispositionQualityIT {

    private static final Path LABELS =
            Path.of("..", "contracts", "review-eval", "naver", "v2", "labels.json");

    private record Row(ReviewTriageTier gold, CaseDisposition rules, boolean investigate, String band,
                       boolean asserted) {
    }

    private static final com.sellerops.reviewissue.RuleBasedIssueSignatureExtractor EXTRACTOR =
            new com.sellerops.reviewissue.RuleBasedIssueSignatureExtractor(false);

    /** Whether the issue extractor finds a problem the customer asserts in this body. */
    static boolean asserted(String body) {
        return EXTRACTOR.extract(body == null ? "" : body).stream().anyMatch(u -> u.signature() != null
                || u.unknownReason() == com.sellerops.reviewissue.UnknownReason.NO_ASPECT);
    }

    static String band(Integer rating, String body) {
        boolean text = body != null && !body.isBlank();
        if (rating == null) {
            return "null";
        }
        return (rating >= 4 ? "4-5" : rating == 3 ? "3" : "1-2") + (text ? "+text" : "+blank");
    }

    @Test
    @DisplayName("the rules' disposition against the human labels — and every false AUTO_RESOLVED")
    void measureDispositionsAgainstTheLabelledSample() throws Exception {
        Map<String, ReviewTriageTier> labels = readLabels();
        List<Row> rows = new ArrayList<>();
        int unlabelled = 0;

        try (Connection db = DriverManager.getConnection(requireEnv("REVIEW_EVAL_JDBC_URL"),
                requireEnv("REVIEW_EVAL_DB_USER"), System.getenv("REVIEW_EVAL_DB_PASSWORD"));
             PreparedStatement ps = db.prepareStatement(
                     "select r.external_id, r.body, r.rating, r.reply_state from reviews r "
                             + "join channels c on c.id = r.channel_id "
                             + "where c.code = 'NAVER' and r.external_id is not null")) {
            db.setReadOnly(true);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String fingerprint = ReviewIdFingerprint.of(rs.getString("external_id"));
                    ReviewTriageTier gold = fingerprint == null ? null : labels.get(fingerprint);
                    if (gold == null) {
                        unlabelled++;
                        continue;
                    }
                    Integer rating = rs.getObject("rating") == null ? null : rs.getInt("rating");
                    ReviewReplyState replyState = parse(rs.getString("reply_state"));
                    OperationsCaseRules.Conclusion conclusion =
                            OperationsCaseRules.forReview(rating, rs.getString("body"), replyState);
                    String body = rs.getString("body");
                    rows.add(new Row(gold, conclusion.disposition(), conclusion.needsInvestigation(),
                            band(rating, body), asserted(body)));
                }
            }
        }

        Map<String, Integer> byGold = new LinkedHashMap<>();
        Map<String, Integer> byRules = new LinkedHashMap<>();
        int falseAutoResolved = 0;
        int falseAutoResolvedOnAttention = 0;
        int investigate = 0;
        int monitoringOnAttention = 0;
        for (Row row : rows) {
            byGold.merge(row.gold().name(), 1, Integer::sum);
            byRules.merge(row.rules() == null ? "INVESTIGATE" : row.rules().name(), 1, Integer::sum);
            if (row.investigate()) {
                investigate++;
                continue;
            }
            if (row.rules() == CaseDisposition.AUTO_RESOLVED && row.gold() != ReviewTriageTier.FYI) {
                falseAutoResolved++;
                if (row.gold() == ReviewTriageTier.NEEDS_ATTENTION) {
                    falseAutoResolvedOnAttention++;
                }
            }
            if (row.rules() == CaseDisposition.MONITORING && row.gold() == ReviewTriageTier.NEEDS_ATTENTION) {
                monitoringOnAttention++;
            }
        }

        Map<String, Integer> breakdown = new java.util.TreeMap<>();
        for (Row row : rows) {
            breakdown.merge(row.band() + (row.asserted() ? " problem" : " none") + " " + row.gold(), 1, Integer::sum);
        }
        System.out.printf("%n  breakdown (band · extractor · gold): %s%n", breakdown);
        System.out.printf("%n  review-disposition/v1 — rules path against %d labelled reviews%n"
                        + "    human labels           %s%n"
                        + "    rules decided          %s%n"
                        + "    reaches the agent      %d%n"
                        + "    FALSE AUTO_RESOLVED    %d  (of which the label says 확인 필요: %d)%n"
                        + "    MONITORING on 확인 필요  %d%n"
                        + "    labelled rows not found in this database: %d%n%n",
                rows.size(), byGold, byRules, investigate, falseAutoResolved, falseAutoResolvedOnAttention,
                monitoringOnAttention, labels.size() - rows.size());

        assertThat(rows).as("the labelled sample must be readable from this database").isNotEmpty();
        assertThat(unlabelled).as("rows outside the labelled sample are skipped, not scored").isNotNegative();
    }

    private static Map<String, ReviewTriageTier> readLabels() throws Exception {
        JsonNode doc = new ObjectMapper().readTree(Files.readString(LABELS));
        Map<String, ReviewTriageTier> labels = new LinkedHashMap<>();
        for (JsonNode label : doc.path("labels")) {
            // UNCERTAIN is a labeller saying they could not decide. It is not a fourth tier and is not scored
            // against: a row a person could not place cannot make the product right or wrong.
            String tier = label.path("tier").asText();
            if ("UNCERTAIN".equals(tier)) {
                continue;
            }
            labels.put(label.path("reviewIdFingerprint").asText(), ReviewTriageTier.valueOf(tier));
        }
        return labels;
    }

    private static ReviewReplyState parse(String raw) {
        try {
            return raw == null ? ReviewReplyState.UNKNOWN : ReviewReplyState.valueOf(raw);
        } catch (IllegalArgumentException unknown) {
            return ReviewReplyState.UNKNOWN;
        }
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required for this gated evaluation");
        }
        return value;
    }
}
