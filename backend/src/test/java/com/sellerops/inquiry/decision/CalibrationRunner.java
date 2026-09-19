package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/**
 * <b>One calibration arm, end to end</b> (Inquiry Decision v2.1) — the variants through the PRODUCTION request builder,
 * the production transport interface, the production response parser and the production enforcement, into rows of ids
 * and closed tokens. Test support; {@code CoverageJudgeCalibrationIT} drives it against the vendor, the harness tests
 * drive it against a fake vendor that answers exactly like one (ids as production numbers them, verdicts reordered).
 *
 * <p>What a row carries so a run can PROVE it was not contaminated — hashes only, never text:
 * <ul>
 *   <li>{@code input_fp} — sha256 of the user turn: the same variant must send byte-identical input in every arm;</li>
 *   <li>{@code system_fp}, {@code schema_fp}, {@code model}, {@code effort}, {@code max_tokens}, {@code format} — the
 *       rest of the request, so arm parity is checkable field by field;</li>
 *   <li>{@code request_fp} — the whole body;</li>
 *   <li>{@code failure} — why a call gave no verdict set. Its needs are written {@code failed: true} with no status: a
 *       failed call is never scored as NONE again (apr-80adf54f).</li>
 * </ul>
 * No retry: each variant × run is sent once and written once, so nothing is counted twice.
 */
public final class CalibrationRunner {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final InquiryDecisionProperties props;
    private final InquiryDecisionGenerator generator;
    private final UUID org;

    public CalibrationRunner(InquiryDecisionProperties props, AgentLlmTransport transport, UUID org) {
        this.props = props;
        this.generator = new InquiryDecisionGenerator(transport, props);
        this.org = org;
    }

    /**
     * @param repeats  runs of each ORIGINAL (run-to-run agreement)
     * @param maxCalls hard cap on sends; exceeded ⇒ exception (the approved cap)
     * @param oracle   when non-null, answers instead of the vendor (offline self-check) — the request is still built
     */
    public Result run(String arm, List<CalibrationVariants.Variant> variants, int repeats, int maxCalls,
                      Function<CalibrationVariants.Variant, Map<String, NeedVerdict>> oracle) throws Exception {
        List<String> out = new ArrayList<>();
        int calls = 0;
        int callId = 0;
        for (CalibrationVariants.Variant v : variants) {
            String body = generator.judgeBody(v.question(), v.needs(), v.evidence(), v.precedents());
            if (!v.needsModel()) {
                Map<String, NeedVerdict> worst = new LinkedHashMap<>();
                List<String> all = v.evidence().stream().map(EvidenceCandidate::id).toList();
                v.needs().forEach(n -> worst.put(n.id(), new NeedVerdict(n.id(), NeedStatus.FULL, all, List.of(),
                        List.of(), List.of(), null, List.of())));
                write(out, arm, 1, ++callId, v, body, new InquiryDecisionModel.Answer<>(worst,
                        InquiryDecisionModel.CallCost.NONE), "WORST_CASE");
                continue;
            }
            int runs = v.kind() == CalibrationVariants.Kind.ORIGINAL ? repeats : 1;
            for (int run = 1; run <= runs; run++) {
                InquiryDecisionModel.Answer<Map<String, NeedVerdict>> a;
                if (oracle != null) {
                    a = new InquiryDecisionModel.Answer<>(oracle.apply(v), InquiryDecisionModel.CallCost.NONE);
                } else {
                    if (calls >= maxCalls) {
                        throw new IllegalStateException("CAL_MAX_CALLS reached: " + calls);
                    }
                    a = generator.judge(org, body, v.needs().stream().map(InquiryNeed::id).toList(),
                            v.evidence().size(), v.precedents().size());
                    calls++;
                }
                write(out, arm, run, ++callId, v, body, a, oracle != null ? "ORACLE" : "MODEL");
            }
        }
        return new Result(out, calls);
    }

    public record Result(List<String> rows, int calls) {
    }

    /** One planner call — for a smoke test of the plan schema. Returns closed tokens and counts only. */
    public String planOnce(String syntheticQuestion) {
        InquiryDecisionModel.Answer<List<InquiryNeed>> a = generator.plan(org, generator.planBody(syntheticQuestion));
        return "answered=" + (a.value() != null) + " failure=" + a.failure() + " needs="
                + (a.value() == null ? -1 : a.value().size()) + " ms=" + a.cost().elapsedMs() + " inTok="
                + a.cost().promptTokens() + " outTok=" + a.cost().completionTokens();
    }

    private void write(List<String> out, String arm, int run, int callId, CalibrationVariants.Variant v, String body,
                       InquiryDecisionModel.Answer<Map<String, NeedVerdict>> answer, String judge) throws Exception {
        JsonNode req = JSON.readTree(body);
        Map<String, NeedVerdict> verdicts = answer.value();
        Map<String, EvidenceCandidate> evidence = new LinkedHashMap<>();
        v.evidence().forEach(e -> evidence.put(e.id(), e));
        Map<String, PrecedentCandidate> precedents = new LinkedHashMap<>();
        v.precedents().forEach(p -> precedents.put(p.id(), p));
        ObjectNode call = JSON.createObjectNode();
        call.put("type", "call").put("arm", arm).put("run", run).put("call", callId).put("q", v.q())
                .put("variant", v.kind().name()).put("target", goldTarget(v)).put("judge", judge)
                .put("answered", verdicts != null).put("failure", answer.failure())
                .put("evidence", v.evidence().size()).put("precedents", v.precedents().size())
                .put("needs", v.needs().size())
                .put("model", req.path("model").asText()).put("effort", req.path("reasoning_effort").asText(null))
                .put("max_tokens", req.path("max_completion_tokens").asInt())
                .put("format", req.path("response_format").path("type").asText())
                .put("system_fp", sha(req.path("messages").path(0).path("content").asText()))
                .put("input_fp", sha(req.path("messages").path(1).path("content").asText()))
                .put("schema_fp", sha(req.path("response_format").toString()))
                .put("request_fp", sha(body));
        long unmatched = verdicts == null ? 0 : verdicts.keySet().stream()
                .filter(k -> v.needs().stream().noneMatch(n -> n.id().equals(k))).count();
        call.put("unmatched_verdicts", unmatched);
        if (answer.cost() != null && answer.cost().calls() > 0) {
            call.put("elapsed_ms", answer.cost().elapsedMs()).put("prompt_tokens", answer.cost().promptTokens())
                    .put("completion_tokens", answer.cost().completionTokens());
        }
        out.add(JSON.writeValueAsString(call));
        if (verdicts == null) {
            for (InquiryNeed n : v.needs()) {
                ObjectNode row = needRow(arm, run, callId, v, n);
                row.put("failed", true).put("failure", answer.failure()).putNull("judged").putNull("enforced");
                out.add(JSON.writeValueAsString(row));
            }
            return;
        }
        for (NeedResult r : NeedAggregation.enforce(v.needs(), verdicts, evidence, precedents, DetailCapability.READABLE,
                v.product())) {
            NeedVerdict raw = verdicts.get(r.need().id());
            ObjectNode n = needRow(arm, run, callId, v, r.need());
            n.put("failed", false).put("judged", r.judged() == null ? null : r.judged().name())
                    .put("enforced", r.status().name())
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

    private static ObjectNode needRow(String arm, int run, int callId, CalibrationVariants.Variant v, InquiryNeed need) {
        ObjectNode n = JSON.createObjectNode();
        n.put("type", "need").put("arm", arm).put("run", run).put("call", callId).put("q", v.q())
                .put("variant", v.kind().name()).put("target", goldTarget(v)).put("need", v.goldId().get(need.id()))
                .put("sent_id", need.id()).put("need_type", need.type().name())
                .put("gold", v.gold().get(need.id()).name()).put("expectation", v.expectation().name());
        return n;
    }

    /** The gold as a judge, answering in PRODUCTION shape: the ids it was sent, in reverse order. */
    public static Map<String, NeedVerdict> oracle(CalibrationVariants.Variant v) {
        Map<String, NeedVerdict> out = new LinkedHashMap<>();
        List<InquiryNeed> reversed = new ArrayList<>(v.needs());
        java.util.Collections.reverse(reversed);
        for (InquiryNeed n : reversed) {
            NeedStatus s = v.gold().get(n.id());
            List<String> ids = s == NeedStatus.NONE ? List.of() : v.goldIds().get(n.id());
            out.put(n.id(), new NeedVerdict(n.id(), s, ids, List.of(), List.of(), List.of(), null, List.of()));
        }
        return out;
    }

    static String goldTarget(CalibrationVariants.Variant v) {
        return "*".equals(v.target()) ? "*" : v.goldId().get(v.target());
    }

    public static String sha(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String sha(byte[] b) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
