package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.JdkAgentLlmTransport;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * <b>CoverageJudge calibration</b> (Inquiry Decision v2.1, docs/inquiry_decision_v2_1.md) — the judge as a component,
 * held to the human gold on the EXACT inputs production would send it. Not a product test.
 *
 * <p>Input: a frozen capture ({@code InquiryNeedEvalIT} with {@code EVAL_DECISION=capture}: the gold needs as the plan,
 * the production collector's candidates) plus the Eval v1 needs and precedent annotations. {@link CalibrationVariants}
 * builds the originals and the counterfactuals; this class sends them and writes what came back — <b>ids and closed
 * tokens only</b>, never a sentence.
 *
 * <ul>
 *   <li>{@code CAL_MODE=offline} — no transport at all. The judge is the gold itself (every expectation must hold: this
 *       checks the harness, not a model), and the code-owned OTHER_LISTING fixtures are enforced against a worst-case
 *       judge that says FULL citing everything.</li>
 *   <li>{@code CAL_MODE=model} — the real judge through {@link InquiryDecisionGenerator} directly (no memo, so a repeat
 *       is a repeat), configured ONLY by this process's env: {@code SELLEROPS_INQUIRY_DECISION_MODEL / _API_KEY /
 *       _JUDGE_PROMPT / _JUDGE_REASONING_EFFORT / _JUDGE_MAX_OUTPUT_TOKENS}. Refuses to start without a key, and
 *       stops at {@code CAL_MAX_CALLS}.</li>
 * </ul>
 * Gated by {@code RUN_COVERAGE_JUDGE_CALIBRATION=true}.
 */
@EnabledIfEnvironmentVariable(named = "RUN_COVERAGE_JUDGE_CALIBRATION", matches = "true")
class CoverageJudgeCalibrationIT {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void calibrate() throws Exception {
        String mode = env("CAL_MODE", "offline");
        String arm = env("CAL_ARM", mode);
        int repeats = Integer.parseInt(env("CAL_REPEATS", "2"));
        int maxCalls = Integer.parseInt(env("CAL_MAX_CALLS", "0"));
        UUID org = UUID.fromString(env("CAL_ORG", UUID.randomUUID().toString()));

        List<CalibrationVariants.Row> rows = new ArrayList<>();
        for (String l : Files.readAllLines(Path.of(System.getenv("CAL_INPUTS")))) {
            if (!l.isBlank()) {
                rows.add(CalibrationVariants.row(JSON.readTree(l)));
            }
        }
        Map<String, JsonNode> gold = new LinkedHashMap<>();
        for (String l : Files.readAllLines(Path.of(System.getenv("CAL_NEEDS")))) {
            if (!l.isBlank()) {
                JsonNode n = JSON.readTree(l);
                gold.put(n.get("q").asText() + "." + n.get("need").asText(), n);
            }
        }
        Set<String> reusable = new HashSet<>();
        for (String l : Files.readAllLines(Path.of(System.getenv("CAL_PRECEDENTS")))) {
            if (!l.isBlank() && "REUSABLE".equals(JSON.readTree(l).get("precedent_scope").asText())) {
                reusable.add(JSON.readTree(l).get("memory").asText());
            }
        }
        List<CalibrationVariants.Variant> variants = CalibrationVariants.build(rows, gold, reusable);
        // CAL_KINDS narrows the run (a smoke test sends ORIGINAL only); absent, every kind is sent.
        // CAL_QS narrows to named questions of the capture (a targeted re-ask of known failures).
        String qs = env("CAL_QS", "");
        if (!qs.isBlank()) {
            List<String> keepQ = List.of(qs.split(","));
            variants = variants.stream().filter(v -> keepQ.contains(v.q())).toList();
        }
        String kinds = env("CAL_KINDS", "");
        if (!kinds.isBlank()) {
            List<String> keep = List.of(kinds.split(","));
            variants = variants.stream().filter(v -> keep.contains(v.kind().name())).toList();
        }

        // The frozen input is pinned: an arm run on a different capture is a different experiment.
        String inputsSha = CalibrationRunner.sha(Files.readAllBytes(Path.of(System.getenv("CAL_INPUTS"))));
        String pinned = env("CAL_INPUTS_SHA256", "");
        if ("model".equals(mode) && !inputsSha.equals(pinned)) {
            throw new IllegalStateException("CAL_INPUTS sha256 does not match CAL_INPUTS_SHA256 — refusing to spend calls");
        }
        InquiryDecisionProperties props = new InquiryDecisionProperties(true, org.toString(),
                env("SELLEROPS_INQUIRY_DECISION_MODEL", "gpt-5-2025-08-07"),
                env("SELLEROPS_INQUIRY_DECISION_API_KEY", "offline-no-key"), 800,
                Integer.parseInt(env("SELLEROPS_INQUIRY_DECISION_JUDGE_MAX_OUTPUT_TOKENS", "2400")),
                env("SELLEROPS_INQUIRY_DECISION_REASONING_EFFORT", "minimal"),
                env("SELLEROPS_INQUIRY_DECISION_JUDGE_PROMPT", InquiryDecisionPrompt.JUDGE_V2),
                env("SELLEROPS_INQUIRY_DECISION_JUDGE_REASONING_EFFORT", ""),
                env("SELLEROPS_INQUIRY_DECISION_OUTPUT_FORMAT", InquiryDecisionProperties.FORMAT_JSON_SCHEMA));
        CalibrationRunner.Result result;
        if ("model".equals(mode)) {
            if (System.getenv("SELLEROPS_INQUIRY_DECISION_API_KEY") == null || maxCalls <= 0) {
                throw new IllegalStateException("CAL_MODE=model needs the key and CAL_MAX_CALLS — the approved cap");
            }
            CalibrationRunner runner = new CalibrationRunner(props, new JdkAgentLlmTransport(), org);
            String smokePlan = env("CAL_SMOKE_PLAN", "");
            if (!smokePlan.isBlank()) {
                // One planner call on a synthetic sentence: does the vendor accept the plan schema? Counted in the cap.
                System.out.println("COVERAGE_JUDGE_SMOKE_PLAN " + runner.planOnce(smokePlan));
                maxCalls -= 1;
            }
            result = runner.run(arm, variants, repeats, maxCalls, null);
        } else if ("replay".equals(mode)) {
            AgentLlmTransport none = (uri, headers, json) -> {
                throw new IllegalStateException("replay mode must not reach a transport");
            };
            List<JsonNode> recorded = new ArrayList<>();
            for (String l : Files.readAllLines(Path.of(System.getenv("CAL_REPLAY")))) {
                if (!l.isBlank()) {
                    recorded.add(JSON.readTree(l));
                }
            }
            result = new CalibrationRunner(props, none, org).replay(arm, variants, recorded);
        } else if ("offline".equals(mode)) {
            AgentLlmTransport none = (uri, headers, json) -> {
                throw new IllegalStateException("offline mode must not reach a transport");
            };
            result = new CalibrationRunner(props, none, org).run(arm, variants, repeats, 0, CalibrationRunner::oracle);
        } else {
            throw new IllegalStateException("CAL_MODE is offline or model, not " + mode);
        }
        Files.write(Path.of(System.getenv("CAL_OUT")), result.rows());
        System.out.println("COVERAGE_JUDGE_CALIBRATION arm=" + arm + " mode=" + mode + " variants=" + variants.size()
                + " counts=" + CalibrationVariants.counts(variants) + " calls=" + result.calls() + " rows="
                + result.rows().size() + " inputs_sha256=" + inputsSha + " prompt=" + props.judgePrompt() + " effort="
                + props.judgeReasoningEffort() + " format=" + props.outputFormat());
    }

    private static String env(String k, String def) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? def : v;
    }
}
