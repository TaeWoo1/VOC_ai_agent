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

        InquiryDecisionGenerator generator = null;
        InquiryDecisionProperties props = null;
        if ("model".equals(mode)) {
            props = new InquiryDecisionProperties(true, org.toString(),
                    env("SELLEROPS_INQUIRY_DECISION_MODEL", "gpt-5-2025-08-07"),
                    env("SELLEROPS_INQUIRY_DECISION_API_KEY", ""), 800,
                    Integer.parseInt(env("SELLEROPS_INQUIRY_DECISION_JUDGE_MAX_OUTPUT_TOKENS", "2400")),
                    env("SELLEROPS_INQUIRY_DECISION_REASONING_EFFORT", "minimal"),
                    env("SELLEROPS_INQUIRY_DECISION_JUDGE_PROMPT", InquiryDecisionPrompt.JUDGE_V2),
                    env("SELLEROPS_INQUIRY_DECISION_JUDGE_REASONING_EFFORT", ""));
            if (!props.isDeployed()) {
                throw new IllegalStateException("CAL_MODE=model without SELLEROPS_INQUIRY_DECISION_API_KEY");
            }
            if (maxCalls <= 0) {
                throw new IllegalStateException("CAL_MODE=model needs CAL_MAX_CALLS — the approved cap");
            }
            AgentLlmTransport transport = new JdkAgentLlmTransport();
            generator = new InquiryDecisionGenerator(transport, props);
        } else if (!"offline".equals(mode)) {
            throw new IllegalStateException("CAL_MODE is offline or model, not " + mode);
        }

        List<String> out = new ArrayList<>();
        int calls = 0;
        int callId = 0;
        for (CalibrationVariants.Variant v : variants) {
            if (!v.needsModel()) {
                // Code-owned: the worst a judge could say — FULL on every need, citing everything — enforced.
                Map<String, NeedVerdict> worst = new LinkedHashMap<>();
                List<String> all = v.evidence().stream().map(EvidenceCandidate::id).toList();
                v.needs().forEach(n -> worst.put(n.id(), new NeedVerdict(n.id(), NeedStatus.FULL, all, List.of(),
                        List.of(), List.of(), null, List.of())));
                write(out, arm, 1, ++callId, v, worst, null);
                continue;
            }
            int runs = v.kind() == CalibrationVariants.Kind.ORIGINAL ? repeats : 1;
            for (int run = 1; run <= runs; run++) {
                Map<String, NeedVerdict> verdicts;
                InquiryDecisionModel.CallCost cost = null;
                if (generator == null) {
                    verdicts = oracle(v);
                } else {
                    if (calls >= maxCalls) {
                        throw new IllegalStateException("CAL_MAX_CALLS reached: " + calls);
                    }
                    String body = generator.judgeBody(v.question(), v.needs(), v.evidence(), v.precedents());
                    InquiryDecisionModel.Answer<Map<String, NeedVerdict>> a = generator.judge(org, body,
                            v.needs().size(), v.evidence().size(), v.precedents().size());
                    calls++;
                    verdicts = a.value();
                    cost = a.cost();
                }
                write(out, arm, run, ++callId, v, verdicts, cost);
            }
        }
        Files.write(Path.of(System.getenv("CAL_OUT")), out);
        System.out.println("COVERAGE_JUDGE_CALIBRATION arm=" + arm + " mode=" + mode + " variants=" + variants.size()
                + " counts=" + CalibrationVariants.counts(variants) + " calls=" + calls + " rows=" + out.size()
                + (props == null ? "" : " prompt=" + props.judgePrompt() + " effort=" + props.judgeReasoningEffort()));
    }

    /** The gold as a judge: what a perfectly calibrated judge says about this variant. */
    private static Map<String, NeedVerdict> oracle(CalibrationVariants.Variant v) {
        Map<String, NeedVerdict> out = new LinkedHashMap<>();
        for (InquiryNeed n : v.needs()) {
            NeedStatus s = v.gold().get(n.id());
            List<String> ids = s == NeedStatus.NONE ? List.of() : v.goldIds().get(n.id());
            out.put(n.id(), new NeedVerdict(n.id(), s, ids, List.of(), List.of(), List.of(), null, List.of()));
        }
        return out;
    }

    private static void write(List<String> out, String arm, int run, int callId, CalibrationVariants.Variant v,
                              Map<String, NeedVerdict> verdicts, InquiryDecisionModel.CallCost cost) throws Exception {
        Map<String, EvidenceCandidate> evidence = new LinkedHashMap<>();
        v.evidence().forEach(e -> evidence.put(e.id(), e));
        Map<String, PrecedentCandidate> precedents = new LinkedHashMap<>();
        v.precedents().forEach(p -> precedents.put(p.id(), p));
        ObjectNode call = JSON.createObjectNode();
        call.put("type", "call").put("arm", arm).put("run", run).put("call", callId).put("q", v.q())
                .put("variant", v.kind().name()).put("target", v.target()).put("answered", verdicts != null)
                .put("evidence", v.evidence().size()).put("precedents", v.precedents().size());
        if (cost != null) {
            call.put("elapsed_ms", cost.elapsedMs()).put("prompt_tokens", cost.promptTokens())
                    .put("completion_tokens", cost.completionTokens());
        }
        out.add(JSON.writeValueAsString(call));
        List<NeedResult> enforced = NeedAggregation.enforce(v.needs(), verdicts == null ? Map.of() : verdicts,
                evidence, precedents, DetailCapability.READABLE, v.product());
        for (NeedResult r : enforced) {
            NeedVerdict raw = verdicts == null ? null : verdicts.get(r.need().id());
            ObjectNode n = JSON.createObjectNode();
            n.put("type", "need").put("arm", arm).put("run", run).put("call", callId).put("q", v.q())
                    .put("variant", v.kind().name()).put("target", v.target()).put("need", r.need().id())
                    .put("need_type", r.need().type().name()).put("gold", v.gold().get(r.need().id()).name())
                    .put("expectation", v.expectation().name())
                    .put("judged", r.judged() == null ? null : r.judged().name()).put("enforced", r.status().name())
                    .put("enforcement", r.enforcement() == null ? null : r.enforcement().name());
            ArrayNode cited = n.putArray("cited");
            if (raw != null) {
                raw.evidence().forEach(cited::add);
            }
            n.put("injected_cited", v.injected() != null && raw != null && raw.evidence().contains(v.injected()));
            n.put("missing_n", raw == null ? 0 : raw.missingInfo().size())
                    .put("customer_input_n", raw == null ? 0 : raw.customerInput().size())
                    .put("assumptions_n", raw == null ? 0 : raw.assumptions().size());
            ArrayNode proposed = n.putArray("precedents");
            r.precedents().forEach(p -> proposed.add(p.memoryId().toString().substring(0, 8)));
            out.add(JSON.writeValueAsString(n));
        }
    }

    private static String env(String k, String def) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? def : v;
    }
}
