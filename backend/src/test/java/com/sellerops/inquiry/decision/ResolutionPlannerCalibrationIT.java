package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.JdkAgentLlmTransport;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * The Resolution Planner run (Inquiry v3 WP-2). Gated: it does nothing unless {@code RUN_RESOLUTION_PLANNER_CAL=true}.
 *
 * <p>{@code PLAN_MODE=oracle} and {@code replay} reach no vendor — the transport they are given throws. {@code model} is a
 * live run: it needs the capability's key and {@code PLAN_MAX_CALLS}, the approved cap, and it is never started without an
 * approval manifest. The output file is created, never overwritten.
 */
@EnabledIfEnvironmentVariable(named = "RUN_RESOLUTION_PLANNER_CAL", matches = "true")
class ResolutionPlannerCalibrationIT {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void run() throws Exception {
        List<ResolutionPlannerRunner.Input> inputs = new ArrayList<>();
        byte[] raw = Files.readAllBytes(Path.of(System.getenv("PLAN_INPUTS")));
        for (String l : new String(raw, java.nio.charset.StandardCharsets.UTF_8).split("\n")) {
            if (!l.isBlank()) {
                inputs.add(ResolutionPlannerRunner.Input.of(JSON.readTree(l)));
            }
        }
        String inputsSha = ResolutionPlannerRunner.sha(new String(raw, java.nio.charset.StandardCharsets.UTF_8));
        String pinned = env("PLAN_INPUTS_SHA256", "");
        if (!pinned.isBlank() && !pinned.equals(inputsSha)) {
            throw new IllegalStateException("PLAN_INPUTS moved: " + inputsSha + " != " + pinned);
        }
        String mode = env("PLAN_MODE", "oracle").toUpperCase(java.util.Locale.ROOT);
        int repeats = Integer.parseInt(env("PLAN_REPEATS", "1"));
        int maxCalls = Integer.parseInt(env("PLAN_MAX_CALLS", "0"));
        String runId = env("PLAN_RUN_ID", "run-" + System.currentTimeMillis());

        InquiryDecisionProperties props = new InquiryDecisionProperties(true, "*",
                env("SELLEROPS_INQUIRY_DECISION_MODEL", "gpt-5-2025-08-07"),
                env("SELLEROPS_INQUIRY_DECISION_API_KEY", "offline-no-key"), 800,
                Integer.parseInt(env("SELLEROPS_INQUIRY_DECISION_JUDGE_MAX_OUTPUT_TOKENS", "2400")),
                env("SELLEROPS_INQUIRY_DECISION_REASONING_EFFORT", "minimal"),
                env("SELLEROPS_INQUIRY_DECISION_JUDGE_PROMPT", InquiryDecisionPrompt.JUDGE_V2),
                env("SELLEROPS_INQUIRY_DECISION_JUDGE_REASONING_EFFORT", ""),
                env("SELLEROPS_INQUIRY_DECISION_OUTPUT_FORMAT", InquiryDecisionProperties.FORMAT_JSON_SCHEMA));
        AgentLlmTransport offline = (uri, headers, json) -> {
            throw new IllegalStateException(mode + " must not reach a transport");
        };
        Map<String, String> oracle = new HashMap<>();
        Map<String, JsonNode> recorded = new HashMap<>();
        ResolutionPlannerRunner.Mode m = ResolutionPlannerRunner.Mode.valueOf(mode);
        if (m == ResolutionPlannerRunner.Mode.ORACLE) {
            for (String l : Files.readAllLines(Path.of(System.getenv("PLAN_GOLD")))) {
                if (!l.isBlank()) {
                    JsonNode g = JSON.readTree(l);
                    oracle.put(g.get("q").asText(), g.get("plan").toString());
                }
            }
        } else if (m == ResolutionPlannerRunner.Mode.REPLAY) {
            for (String l : Files.readAllLines(Path.of(System.getenv("PLAN_REPLAY")))) {
                if (!l.isBlank()) {
                    JsonNode r = JSON.readTree(l);
                    recorded.put(r.get("q").asText() + "|" + r.get("rep").asInt(), r);
                }
            }
        } else if (System.getenv("SELLEROPS_INQUIRY_DECISION_API_KEY") == null || maxCalls <= 0) {
            throw new IllegalStateException("PLAN_MODE=model needs the key and PLAN_MAX_CALLS — the approved cap");
        }
        ResolutionPlannerRunner runner = new ResolutionPlannerRunner(props,
                m == ResolutionPlannerRunner.Mode.MODEL ? new JdkAgentLlmTransport() : offline,
                UUID.fromString(env("PLAN_ORG", "00000000-0000-0000-0000-000000000000")));
        ResolutionPlannerRunner.Result result = runner.run(runId, m, inputs, repeats, maxCalls, oracle, recorded);
        ResolutionPlannerRunner.write(Path.of(System.getenv("PLAN_OUT")), result.rows());
        System.out.println("RESOLUTION_PLANNER run_id=" + runId + " mode=" + mode + " inputs=" + inputs.size()
                + " repeats=" + repeats + " calls=" + result.calls() + " rows=" + result.rows().size()
                + " inputs_sha256=" + inputsSha + " prompt=" + com.sellerops.inquiry.resolution.ResolutionPlannerPrompt.VERSION
                + " model=" + props.model() + " effort=" + props.reasoningEffort());
    }

    private static String env(String k, String def) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? def : v;
    }
}
