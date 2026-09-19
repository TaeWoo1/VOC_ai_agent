package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.inquiry.draft.AnswerBasisState;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The vendor contract of Inquiry Decision</b> (v2.1 integration audit) — what goes out and what is accepted back,
 * asserted on bytes. Deterministic: every transport here is a fake that answers exactly as the vendor's Chat Completions
 * envelope does.
 */
class JudgeIntegrationContractTest {

    static final ObjectMapper JSON = new ObjectMapper();
    static final UUID ORG = UUID.randomUUID();
    static final List<InquiryNeed> NEEDS = List.of(new InquiryNeed("N1", "가", NeedType.PRODUCT_SPEC, "가"),
            new InquiryNeed("N2", "나", NeedType.POLICY, "나"));
    static final List<EvidenceCandidate> EVIDENCE = List.of(new EvidenceCandidate("E1",
            EvidenceCandidate.Kind.PRODUCT_KNOWLEDGE, "제목", "본문", UUID.randomUUID(), null, null));
    static final List<PrecedentCandidate> PRECEDENTS = List.of();

    static InquiryDecisionProperties props(String prompt, String effort, String format) {
        return new InquiryDecisionProperties(true, ORG.toString(), "gpt-5-2025-08-07", "sk-test", 800, 6000, "minimal",
                prompt, effort, format);
    }

    static String envelope(String content) {
        ObjectNode root = JSON.createObjectNode();
        ObjectNode choice = root.putArray("choices").addObject();
        choice.put("finish_reason", "stop");
        choice.putObject("message").put("role", "assistant").put("content", content).putNull("refusal");
        root.putObject("usage").put("prompt_tokens", 10).put("completion_tokens", 5);
        return root.toString();
    }

    static AgentLlmTransport answering(int status, String body) {
        return (uri, headers, json) -> new AgentLlmTransport.Response(status, body, 7);
    }

    static InquiryDecisionModel.Answer<Map<String, NeedVerdict>> judgeWith(AgentLlmTransport t) {
        InquiryDecisionGenerator g = new InquiryDecisionGenerator(t, props(InquiryDecisionPrompt.JUDGE_V2, "", "json_schema"));
        return g.judge(ORG, g.judgeBody("q", NEEDS, EVIDENCE, PRECEDENTS), List.of("N1", "N2"), 1, 0);
    }

    static final String V1 = "{\"need\":\"N1\",\"status\":\"FULL\",\"evidence\":[\"E1\"],\"missing\":[],\"customer_input\":[],"
            + "\"assumptions\":[],\"ask_customer\":null,\"precedents\":[]}";
    static final String V2 = "{\"need\":\"N2\",\"status\":\"NONE\",\"evidence\":[],\"missing\":[\"기준\"],\"customer_input\":[],"
            + "\"assumptions\":[],\"ask_customer\":null,\"precedents\":[]}";

    // ── the response envelope ───────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("refusal, cut-off, HTTP failure, transport failure, empty and garbage are distinct failures — no verdicts")
    void envelopeFailures() {
        String refusal = "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":null,\"refusal\":\"no\"}}]}";
        String truncated = "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"{\\\"verdicts\\\":[\"}}]}";
        assertThat(judgeWith(answering(200, refusal)).failure()).isEqualTo("REFUSAL");
        assertThat(judgeWith(answering(200, truncated)).failure()).isEqualTo("TRUNCATED");
        assertThat(judgeWith(answering(429, "{}")).failure()).isEqualTo("HTTP_429");
        assertThat(judgeWith(answering(0, "SocketTimeoutException")).failure()).isEqualTo("TRANSPORT");
        assertThat(judgeWith(answering(200, envelope(""))).failure()).isEqualTo("EMPTY");
        assertThat(judgeWith(answering(200, "not json")).failure()).isEqualTo("UNPARSEABLE");
        assertThat(judgeWith(answering(200, envelope("{\"verdicts\":[" + V1 + "," + V2 + "]}"))).failure()).isNull();
    }

    // ── the verdict set ─────────────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("the verdict set must be exactly the needs sent: reordered passes; missing, duplicate, extra, re-cased fail")
    void verdictSet() {
        assertThat(InquiryDecisionGenerator.parseJudge("{\"verdicts\":[" + V2 + "," + V1 + "]}", List.of("N1", "N2"))
                .verdicts()).containsOnlyKeys("N1", "N2");
        for (String bad : List.of(
                "{\"verdicts\":[" + V1 + "]}",                                              // missing N2
                "{\"verdicts\":[" + V1 + "," + V1 + "," + V2 + "]}",                        // N1 twice
                "{\"verdicts\":[" + V1 + "," + V2 + "," + V2.replace("N2", "N3") + "]}",    // an id never sent
                "{\"verdicts\":[" + V1.replace("N1", "n1") + "," + V2 + "]}",               // the apr-80adf54f shape
                "{\"verdicts\":[" + V1.replace("FULL", "MOSTLY") + "," + V2 + "]}")) {      // a status not in the list
            assertThat(InquiryDecisionGenerator.parseJudge(bad, List.of("N1", "N2")).failure()).as(bad)
                    .isEqualTo("VERDICT_SET");
        }
    }

    @Test
    @DisplayName("production: a duplicated verdict can no longer turn a NONE into a FULL — the judge fails and the seller has the Case")
    void duplicateFailsClosed() {
        String dup = envelope("{\"verdicts\":[" + V2.replace("NONE", "NONE") + "," + V1 + ","
                + V2.replace("\"NONE\"", "\"FULL\"").replace("\"evidence\":[]", "\"evidence\":[\"E1\"]")
                        .replace("[\"기준\"]", "[]") + "]}");
        InquiryDecisionService service = new InquiryDecisionService(props(InquiryDecisionPrompt.JUDGE_V2, "",
                "json_schema"), null, answering(200, dup));
        NeedDecision d = InquiryDecisionEngine.decide(ORG, "q",
                new InquiryDecisionModel() {
                    public boolean enabledFor(UUID o) {
                        return true;
                    }

                    public Answer<List<InquiryNeed>> plan(UUID o, String q) {
                        return new Answer<>(NEEDS, CallCost.NONE);
                    }

                    public Answer<Map<String, NeedVerdict>> judge(UUID o, String q, List<InquiryNeed> n,
                                                                  List<EvidenceCandidate> e, List<PrecedentCandidate> p) {
                        return service.judge(o, q, n, e, p);
                    }
                }, needs -> new InquiryDecisionEngine.Pool(EVIDENCE, PRECEDENTS), DetailCapability.READABLE);
        assertThat(d.outcome()).isEqualTo(NeedDecision.Outcome.JUDGE_FAILED);
        assertThat(d.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
    }

    // ── the schema ──────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("strict json_schema: closed objects, every field required, need ids an enum of exactly the ids sent")
    void strictSchema() throws Exception {
        InquiryDecisionGenerator g = new InquiryDecisionGenerator(null, props(InquiryDecisionPrompt.JUDGE_V2, "", "json_schema"));
        JsonNode rf = JSON.readTree(g.judgeBody("q", NEEDS, EVIDENCE, PRECEDENTS)).path("response_format");
        assertThat(rf.path("type").asText()).isEqualTo("json_schema");
        assertThat(rf.path("json_schema").path("strict").asBoolean()).isTrue();
        JsonNode verdicts = rf.path("json_schema").path("schema").path("properties").path("verdicts");
        assertThat(verdicts.path("minItems").asInt()).isEqualTo(2);
        assertThat(verdicts.path("maxItems").asInt()).isEqualTo(2);
        JsonNode item = verdicts.path("items");
        assertThat(item.path("additionalProperties").asBoolean(true)).isFalse();
        assertThat(names(item.path("properties"))).isEqualTo(texts(item.path("required")));
        assertThat(texts(item.path("properties").path("need").path("enum"))).containsExactly("N1", "N2");
        assertThat(texts(item.path("properties").path("evidence").path("items").path("enum"))).containsExactly("E1");
        assertThat(item.path("properties").path("precedents").path("maxItems").asInt(-1))
                .as("no past answer was sent, so none may be named").isZero();
        assertThat(names(item.path("properties"))).contains("assumptions", "customer_input");

        InquiryDecisionGenerator v1 = new InquiryDecisionGenerator(null, props(InquiryDecisionPrompt.JUDGE_V1, "", "json_schema"));
        JsonNode v1Item = JSON.readTree(v1.judgeBody("q", NEEDS, EVIDENCE, PRECEDENTS)).path("response_format")
                .path("json_schema").path("schema").path("properties").path("verdicts").path("items");
        assertThat(names(v1Item.path("properties"))).doesNotContain("assumptions", "customer_input");

        JsonNode plan = JSON.readTree(g.planBody("q")).path("response_format");
        assertThat(plan.path("json_schema").path("strict").asBoolean()).isTrue();
        assertThat(texts(plan.path("json_schema").path("schema").path("properties").path("needs").path("items")
                .path("properties").path("type").path("enum"))).hasSize(NeedType.values().length);

        InquiryDecisionGenerator legacy = new InquiryDecisionGenerator(null, props(InquiryDecisionPrompt.JUDGE_V2, "", "json_object"));
        assertThat(JSON.readTree(legacy.judgeBody("q", NEEDS, EVIDENCE, PRECEDENTS)).path("response_format").toString())
                .as("the pre-audit shape stays reproducible").isEqualTo("{\"type\":\"json_object\"}");
    }

    // ── arm parity ──────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("A→B changes only the judge instruction and its schema; B→C changes only reasoning_effort")
    void armParity() throws Exception {
        JsonNode a = body(InquiryDecisionPrompt.JUDGE_V1, "minimal");
        JsonNode b = body(InquiryDecisionPrompt.JUDGE_V2, "minimal");
        JsonNode c = body(InquiryDecisionPrompt.JUDGE_V2, "low");
        assertThat(diff("", a, b)).containsExactlyInAnyOrder("/messages/0/content", "/response_format");
        assertThat(diff("", b, c)).containsExactly("/reasoning_effort");
        assertThat(a.path("messages").path(1)).as("the input is byte-identical across arms").isEqualTo(c.path("messages").path(1));
    }

    static JsonNode body(String prompt, String effort) throws Exception {
        return JSON.readTree(new InquiryDecisionGenerator(null, props(prompt, effort, "json_schema"))
                .judgeBody("q", NEEDS, EVIDENCE, PRECEDENTS));
    }

    /** Paths where two JSON trees differ; an object whose children all differ collapses to its own path. */
    static List<String> diff(String path, JsonNode x, JsonNode y) {
        List<String> out = new ArrayList<>();
        if (x.equals(y)) {
            return out;
        }
        if (x.isObject() && y.isObject() && !path.equals("/response_format")) {
            TreeSet<String> keys = new TreeSet<>(names(x));
            keys.addAll(names(y));
            keys.forEach(k -> out.addAll(diff(path + "/" + k, x.path(k), y.path(k))));
        } else if (x.isArray() && y.isArray() && x.size() == y.size()) {
            for (int i = 0; i < x.size(); i++) {
                out.addAll(diff(path + "/" + i, x.get(i), y.get(i)));
            }
        } else {
            out.add(path);
        }
        return out;
    }

    // ── the memo cannot carry an answer across arms ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("the memo key is the whole request, and the memo belongs to one service — arms cannot share an answer")
    void memoIsPerRequestAndPerService() throws Exception {
        assertThat(java.lang.reflect.Modifier.isStatic(InquiryDecisionService.class.getDeclaredField("memo").getModifiers()))
                .isFalse();
        int[] posts = {0};
        String ok = envelope("{\"verdicts\":[" + V1 + "," + V2 + "]}");
        AgentLlmTransport counting = (uri, headers, json) -> {
            posts[0]++;
            return new AgentLlmTransport.Response(200, ok, 1);
        };
        InquiryDecisionService b = new InquiryDecisionService(props(InquiryDecisionPrompt.JUDGE_V2, "minimal", "json_schema"),
                null, counting);
        InquiryDecisionService c = new InquiryDecisionService(props(InquiryDecisionPrompt.JUDGE_V2, "low", "json_schema"),
                null, counting);
        b.judge(ORG, "q", NEEDS, EVIDENCE, PRECEDENTS);
        c.judge(ORG, "q", NEEDS, EVIDENCE, PRECEDENTS);
        assertThat(posts[0]).isEqualTo(2);
        assertThat(b.generator().judgeBody("q", NEEDS, EVIDENCE, PRECEDENTS))
                .isNotEqualTo(c.generator().judgeBody("q", NEEDS, EVIDENCE, PRECEDENTS));
    }

    static List<String> names(JsonNode n) {
        List<String> out = new ArrayList<>();
        Iterator<String> it = n.fieldNames();
        it.forEachRemaining(out::add);
        return out;
    }

    static List<String> texts(JsonNode n) {
        List<String> out = new ArrayList<>();
        n.forEach(x -> out.add(x.asText()));
        return out;
    }
}
