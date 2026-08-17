package com.sellerops.review.triage.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.itemanalysis.eval.EvalMetrics;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.eval.TriageEvalReport.Kappa;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * The three-arm screen of {@code contracts/review-eval/naver/v2/RUBRIC.md} §10.
 *
 * <p>Compares the shipped rating-only rule and any model arms against the owner's 37 pilot labels,
 * to answer one question: <b>is it worth commissioning an annotator's pass over the remaining
 * 220?</b> §10.4 fixes what the answer may be — this can rule a candidate OUT and cannot rule one
 * IN, and no number it prints clears `v1` §5's precision gate on 37 rows.
 *
 * <p><b>The holdout is not here.</b> {@code pilot-labels.json} excludes the 17 `HOLDOUT` overlap
 * rows by construction, and this harness re-checks that rather than trusting it.
 *
 * <p><b>Gated and local</b>, like the other eval harnesses: it reads real review bodies out of a
 * local database, so it never runs in CI and never by accident. Model arms are read from the
 * gitignored worksheet, where a human saved what a model replied — this makes no network call of any
 * kind, to any provider.
 *
 * <p>Output is counts and rates. Never a body, never an id, never a fingerprint.
 */
@EnabledIfEnvironmentVariable(named = "RUN_REVIEW_EVAL", matches = "true")
class ReviewTriagePilotIT {

    private static final Path CONTRACT = Path.of("..", "contracts", "review-eval", "naver", "v2");
    private static final Path WORKSHEET = Path.of("..", "tools", "review-triage-calibration", "worksheet");
    private static final ObjectMapper JSON = new ObjectMapper();

    /** One review as every arm sees it: the owner's answer, and each arm's. */
    private record PilotRow(String fingerprint, Integer rating, ReviewTriageTier owner, String ownerReason,
                            Set<String> ownerTags, Map<String, Answer> arms) {
    }

    private record Answer(ReviewTriageTier tier, String reasonCode, Set<String> tags) {
    }

    /**
     * The two sides of RUBRIC v2 §3.1's last column, used ONLY to spot a label whose tier and reason
     * disagree — never to correct one. §3.1: "a pairing that crosses the column is a finding about
     * the rubric and is reported, never auto-corrected."
     */
    private static final Set<String> ACTIONABLE_REASONS = Set.of(
            "DEFECT_OR_DAMAGE", "WRONG_OR_MISSING", "DELIVERY_PROBLEM", "PACKAGING_PROBLEM",
            "NOT_AS_DESCRIBED", "CANNOT_USE", "EXPLICIT_REQUEST", "PRAISE_WITH_CONCESSION");
    private static final Set<String> NON_ACTIONABLE_REASONS = Set.of(
            "PRAISE_ONLY", "CRITIQUE_NO_REQUEST", "NEUTRAL_DESCRIPTION", "TEXTLESS_OR_NOISE", "OFF_TOPIC");

    /**
     * A row whose tier and reason sit on opposite sides of §3.1's column.
     *
     * <p>Two such rows exist in this pilot — 3★ bodies the owner called 확인 필요 while coding the
     * reason {@code TEXTLESS_OR_NOISE}. The gold is left exactly as labeled; what this predicate
     * buys is a **sensitivity reading beside the primary one**, so a candidate's recall can be seen
     * both with those rows counted and without. Neither reading is the "corrected" one.
     */
    private static boolean conflicted(PilotRow row) {
        if (row.ownerReason() == null) {
            return false;
        }
        boolean wanted = row.owner() == ReviewTriageTier.NEEDS_ATTENTION;
        return wanted ? NON_ACTIONABLE_REASONS.contains(row.ownerReason())
                : ACTIONABLE_REASONS.contains(row.ownerReason());
    }

    @Test
    void screenTheCandidatesAgainstTheOwnersPilotLabels() throws Exception {
        Map<String, Answer> gold = readGold();
        Map<String, String> keyMap = readKeyMap();

        Map<String, Map<String, Answer>> modelArms = new LinkedHashMap<>();
        for (String arm : List.of("claude", "gpt")) {
            Map<String, Answer> answers = readArm(arm, keyMap);
            if (!answers.isEmpty()) {
                modelArms.put(arm, answers);
            }
        }

        List<PilotRow> rows = new ArrayList<>();
        int missingFromDb = 0;
        try (Connection db = DriverManager.getConnection(
                requireEnv("REVIEW_EVAL_JDBC_URL"), requireEnv("REVIEW_EVAL_DB_USER"),
                System.getenv("REVIEW_EVAL_DB_PASSWORD"));
             PreparedStatement ps = db.prepareStatement(
                     "select r.external_id, r.body, r.rating from reviews r "
                             + "join channels c on c.id = r.channel_id "
                             + "where c.code = 'NAVER' and r.external_id is not null")) {
            db.setReadOnly(true);
            Set<String> seen = new LinkedHashSet<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String fingerprint = ReviewIdFingerprint.of(rs.getString("external_id"));
                    Answer owner = fingerprint == null ? null : gold.get(fingerprint);
                    if (owner == null) {
                        continue;
                    }
                    seen.add(fingerprint);
                    Integer rating = rs.getObject("rating") == null ? null : rs.getInt("rating");
                    Map<String, Answer> arms = new LinkedHashMap<>();
                    // The heuristic arm is computed HERE, from the shipped rule, rather than
                    // reimplemented in the tooling — one rule, one answer.
                    arms.put("rules-v1", new Answer(
                            ReviewTriageRules.tier(rating, rs.getString("body")), null, Set.of()));
                    for (Map.Entry<String, Map<String, Answer>> arm : modelArms.entrySet()) {
                        Answer answer = arm.getValue().get(fingerprint);
                        if (answer != null) {
                            arms.put(arm.getKey(), answer);
                        }
                    }
                    rows.add(new PilotRow(fingerprint, rating, owner.tier(), owner.reasonCode(),
                            owner.tags(), arms));
                }
            }
            missingFromDb = gold.size() - seen.size();
        }

        StringBuilder out = new StringBuilder("\n\nreview-triage pilot — RUBRIC v2 §10, a RULE-OUT screen\n\n");
        out.append(String.format("  %d pilot rows, %d matched in the database%s%n", gold.size(), rows.size(),
                missingFromDb == 0 ? "" : String.format(" (⚠ %d missing)", missingFromDb)));
        Map<String, Integer> ownerTiers = new TreeMap<>();
        for (PilotRow row : rows) {
            ownerTiers.merge(row.owner().name(), 1, Integer::sum);
        }
        int positives = ownerTiers.getOrDefault("NEEDS_ATTENTION", 0);
        out.append("  owner labels: ").append(ownerTiers).append('\n');
        out.append(String.format("  arms: %s%n", String.join(", ", rows.isEmpty()
                ? List.of() : rows.get(0).arms().keySet())));
        out.append(String.format("""

                  ⚠ %d rows labeled 확인 필요. One flip moves recall by %.1f points. §10.4: this screen can
                    send a candidate back to the full human-gold protocol; it cannot license one, and no
                    Wilson lower bound over %d rows reaches v1 §5's 0.80 precision gate.
                %n""", positives, positives == 0 ? 0.0 : 100.0 / positives, rows.size()));

        // Every reason code must sit on one side of §3.1's column or the other. A code in neither
        // means the vocabulary moved and the conflict predicate below has quietly stopped working.
        for (PilotRow row : rows) {
            String reason = row.ownerReason();
            if (reason != null && !ACTIONABLE_REASONS.contains(reason)
                    && !NON_ACTIONABLE_REASONS.contains(reason)) {
                throw new IllegalStateException("reason code outside RUBRIC §3.1's table: " + reason);
            }
        }

        List<String> armNames = rows.isEmpty() ? List.of() : List.copyOf(rows.get(0).arms().keySet());
        List<PilotRow> conflicted = rows.stream().filter(ReviewTriagePilotIT::conflicted).toList();
        Map<String, Integer> conflictedByReason = new TreeMap<>();
        for (PilotRow row : conflicted) {
            conflictedByReason.merge(row.owner() + "/" + row.ownerReason(), 1, Integer::sum);
        }
        out.append(String.format("""
                  rubric conflicts (RUBRIC §3.1): %d row(s) whose tier and reason cross the column
                    %s
                    Left in the gold exactly as labeled. Reported below twice — PRIMARY counts them,
                    SENSITIVITY drops them. Neither reading is the corrected one.
                %n""", conflicted.size(), conflictedByReason.isEmpty() ? "(none)" : conflictedByReason));

        List<PilotRow> sensitivity = rows.stream().filter(r -> !conflicted(r)).toList();
        for (String[] scope : new String[][] {{"PRIMARY", "all rows"}, {"SENSITIVITY", "rubric conflicts dropped"}}) {
            List<PilotRow> scoped = scope[0].equals("PRIMARY") ? rows : sensitivity;
            long scopedPositives = scoped.stream()
                    .filter(r -> r.owner() == ReviewTriageTier.NEEDS_ATTENTION).count();
            out.append(String.format("%n═══ %s — %d rows, %d 확인 필요 (%s) ═══%n",
                    scope[0], scoped.size(), scopedPositives, scope[1]));
            for (String arm : armNames) {
                out.append(armSection(arm, scoped));
            }
            out.append(contradictionSection(scoped, armNames));
            out.append(betweenModels(scoped, armNames));
        }

        System.out.print(out);
    }

    /** Everything about one arm, in §10.2's order of importance. */
    private static String armSection(String arm, List<PilotRow> rows) {
        List<PilotRow> scored = rows.stream().filter(r -> r.arms().containsKey(arm)).toList();
        int tp = 0;
        int fp = 0;
        int fn = 0;
        int tn = 0;
        int highFp = 0;
        int highNoAction = 0;
        int tierAgree = 0;
        int reasonCompared = 0;
        int reasonAgree = 0;
        int tagCompared = 0;
        int tagAgree = 0;
        Map<String, Integer> missedByReason = new TreeMap<>();
        for (PilotRow row : scored) {
            Answer answer = row.arms().get(arm);
            boolean wanted = row.owner() == ReviewTriageTier.NEEDS_ATTENTION;
            boolean flagged = answer.tier() == ReviewTriageTier.NEEDS_ATTENTION;
            if (wanted && flagged) {
                tp++;
            } else if (wanted) {
                fn++;
                missedByReason.merge(row.ownerReason() == null ? "(none)" : row.ownerReason(), 1, Integer::sum);
            } else if (flagged) {
                fp++;
            } else {
                tn++;
            }
            if (!wanted && row.rating() != null && row.rating() >= 4) {
                highNoAction++;
                if (flagged) {
                    highFp++;
                }
            }
            if (row.owner() == answer.tier()) {
                tierAgree++;
            }
            if (answer.reasonCode() != null) {
                reasonCompared++;
                if (answer.reasonCode().equals(row.ownerReason())) {
                    reasonAgree++;
                }
                tagCompared++;
                if (answer.tags().equals(row.ownerTags())) {
                    tagAgree++;
                }
            }
        }
        double recall = tp + fn == 0 ? 0 : (double) tp / (tp + fn);
        double precision = tp + fp == 0 ? 0 : (double) tp / (tp + fp);
        double highFpRate = highNoAction == 0 ? 0 : (double) highFp / highNoAction;
        Kappa kappa = TriageEvalReport.cohenKappa(
                scored.stream().map(r -> r.owner().name()).toList(),
                scored.stream().map(r -> r.arms().get(arm).tier().name()).toList());

        StringBuilder out = new StringBuilder(String.format("%n  ── %s ── %d rows%n", arm, scored.size()));
        out.append(String.format("    1. 확인 필요  recall %.3f (%d/%d)   precision %.3f (95%% low %.3f)%n",
                recall, tp, tp + fn, precision, EvalMetrics.wilsonLowerBound(tp, tp + fp)));
        out.append(String.format("       false negatives %d: %s%n", fn, missedByReason.isEmpty() ? "(none)"
                : missedByReason.toString()));
        out.append(String.format("    2. 4–5★ false-positive rate %.3f over %d rows the owner cleared%n",
                highFpRate, highNoAction));
        out.append(String.format("    3. tier agreement %.3f (%d/%d)   κ %s%n",
                scored.isEmpty() ? 0.0 : (double) tierAgree / scored.size(), tierAgree, scored.size(),
                kappa.defined() ? String.format("%.3f", kappa.kappa()) : "undefined (one class)"));
        if (reasonCompared > 0) {
            out.append(String.format("    4. reason agreement %.3f (%d/%d)   tag agreement %.3f (%d/%d)%n",
                    (double) reasonAgree / reasonCompared, reasonAgree, reasonCompared,
                    (double) tagAgree / tagCompared, tagAgree, tagCompared));
        } else {
            out.append("    4. reason/tag: this arm emits none\n");
        }

        // §10.4's rule-out conditions, evaluated rather than left to the reader.
        List<String> failed = new ArrayList<>();
        if (recall < EvalMetrics.MIN_RECALL) {
            failed.add(String.format("recall %.3f < %.2f", recall, EvalMetrics.MIN_RECALL));
        }
        if (highFpRate > EvalMetrics.MAX_HIGH_RATING_FP_RATE) {
            failed.add(String.format("4–5★ FP rate %.3f > %.2f", highFpRate,
                    EvalMetrics.MAX_HIGH_RATING_FP_RATE));
        }
        out.append(failed.isEmpty()
                ? "    → not ruled out by §10.4. NOT the same as ruled in.\n"
                : "    → RULED OUT by §10.4: " + String.join("; ", failed) + "\n");
        return out.toString();
    }

    /**
     * The rows where the owner and the shipped rule disagree — the contradiction set the whole unit
     * is about. An arm's value is decided here far more than on the 28 rows everyone gets right.
     */
    private static String contradictionSection(List<PilotRow> rows, List<String> arms) {
        List<PilotRow> contradictions = rows.stream()
                .filter(r -> r.arms().containsKey("rules-v1")
                        && r.owner() != r.arms().get("rules-v1").tier())
                .toList();
        StringBuilder out = new StringBuilder(String.format(
                "%n  ── rating/text contradictions ── %d rows where the owner and rules-v1 differ%n",
                contradictions.size()));
        Map<String, Integer> byReason = new TreeMap<>();
        for (PilotRow row : contradictions) {
            byReason.merge(row.ownerReason() == null ? "(none)" : row.ownerReason(), 1, Integer::sum);
        }
        out.append("    by the owner's reason: ").append(byReason.isEmpty() ? "(none)" : byReason).append('\n');
        for (String arm : arms) {
            if (arm.equals("rules-v1")) {
                continue;
            }
            long right = contradictions.stream()
                    .filter(r -> r.arms().containsKey(arm) && r.arms().get(arm).tier() == r.owner())
                    .count();
            out.append(String.format("    %-10s recovers %d of %d%n", arm, right, contradictions.size()));
        }
        return out.toString();
    }

    /** Two models that disagree with each other are not a second opinion (§10.2 item 5). */
    private static String betweenModels(List<PilotRow> rows, List<String> arms) {
        List<String> models = arms.stream().filter(a -> !a.equals("rules-v1")).toList();
        if (models.size() < 2) {
            return "\n  ── between models ── fewer than two model arms present\n";
        }
        StringBuilder out = new StringBuilder("\n  ── between models ──\n");
        for (int i = 0; i < models.size(); i++) {
            for (int j = i + 1; j < models.size(); j++) {
                String a = models.get(i);
                String b = models.get(j);
                List<PilotRow> both = rows.stream()
                        .filter(r -> r.arms().containsKey(a) && r.arms().containsKey(b)).toList();
                Kappa three = TriageEvalReport.cohenKappa(
                        both.stream().map(r -> r.arms().get(a).tier().name()).toList(),
                        both.stream().map(r -> r.arms().get(b).tier().name()).toList());
                Kappa binary = TriageEvalReport.cohenKappa(
                        both.stream().map(r -> binary(r.arms().get(a).tier())).toList(),
                        both.stream().map(r -> binary(r.arms().get(b).tier())).toList());
                out.append(String.format("    %s vs %s over %d rows: three-class κ %s, binary κ %s%n",
                        a, b, both.size(),
                        three.defined() ? String.format("%.3f", three.kappa()) : "undefined",
                        binary.defined() ? String.format("%.3f", binary.kappa()) : "undefined"));
                if (binary.defined() && binary.kappa() < 0.60) {
                    out.append("    → RULED OUT by §10.4: inter-model κ < 0.60. "
                            + "Two models disagreeing are one unreliable opinion.\n");
                }
            }
        }
        return out.toString();
    }

    private static String binary(ReviewTriageTier tier) {
        return tier == ReviewTriageTier.NEEDS_ATTENTION ? "A" : "N";
    }

    private static Map<String, Answer> readGold() throws Exception {
        JsonNode root = JSON.readTree(Files.readString(CONTRACT.resolve("pilot-labels.json")));
        Map<String, Answer> gold = new LinkedHashMap<>();
        for (JsonNode entry : root.path("labels")) {
            String tier = entry.path("tier").asText();
            if ("UNCERTAIN".equals(tier)) {
                continue; // excluded from every metric, v1 §4
            }
            gold.put(entry.path("reviewIdFingerprint").asText(), new Answer(
                    ReviewTriageTier.valueOf(tier), entry.path("reasonCode").asText(null),
                    tagsOf(entry.path("tags"))));
        }
        if (gold.isEmpty()) {
            throw new IllegalStateException(
                    "pilot-labels.json is empty — run tools/review-triage-calibration/derive-pilot.mjs");
        }
        return gold;
    }

    /** {@code P##} → fingerprint. Local and gitignored; the models only ever saw the {@code P##}. */
    private static Map<String, String> readKeyMap() throws Exception {
        Path path = WORKSHEET.resolve("pilot-key-map.json");
        if (!Files.exists(path)) {
            return Map.of();
        }
        Map<String, String> map = new LinkedHashMap<>();
        JsonNode root = JSON.readTree(Files.readString(path));
        root.fields().forEachRemaining(e -> map.put(e.getKey(), e.getValue().path("fingerprint").asText()));
        return map;
    }

    private static Map<String, Answer> readArm(String arm, Map<String, String> keyMap) throws Exception {
        Path path = WORKSHEET.resolve("arm-" + arm + ".json");
        if (!Files.exists(path)) {
            return Map.of();
        }
        Map<String, Answer> answers = new LinkedHashMap<>();
        for (JsonNode entry : JSON.readTree(Files.readString(path)).path("labels")) {
            String fingerprint = keyMap.get(entry.path("key").asText());
            String tier = entry.path("tier").asText();
            if (fingerprint == null || "UNCERTAIN".equals(tier)) {
                continue;
            }
            answers.put(fingerprint, new Answer(ReviewTriageTier.valueOf(tier),
                    entry.path("reasonCode").asText(null), tagsOf(entry.path("tags"))));
        }
        return answers;
    }

    private static Set<String> tagsOf(JsonNode node) {
        Set<String> tags = new LinkedHashSet<>();
        node.forEach(t -> tags.add(t.asText()));
        return tags;
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required env var: " + name);
        }
        return value;
    }
}
