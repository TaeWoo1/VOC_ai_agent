package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.UnaryOperator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The calibration harness cannot contaminate its own result</b> (Inquiry Decision v2.1 audit).
 *
 * <p>The self-check that let apr-80adf54f through fed the gold back in the gold's own ids, so an id-shape mismatch
 * between what the harness sent and what a real judge answers could not show. Here the judge is a FAKE VENDOR: it
 * reads the serialized request exactly as the vendor would, answers in the Chat Completions envelope with the ids the
 * request carried — in reverse order — and every mutation of that answer (re-cased, missing, duplicated, invented ids)
 * must surface as a failed call, never as a NONE.
 */
class CalibrationHarnessIntegrityTest {

    static final ObjectMapper JSON = new ObjectMapper();
    static final UUID ORG = UUID.randomUUID();
    static final UUID P1 = UUID.randomUUID();
    static final UUID P2 = UUID.randomUUID();
    static final UUID SRC_A = UUID.randomUUID();
    static final UUID SRC_B = UUID.randomUUID();

    /** Three captured questions in production shape and their gold: FULL + NONE, CONDITIONAL, PARTIAL. */
    static List<CalibrationVariants.Variant> variants() throws Exception {
        String a8 = SRC_A.toString().substring(0, 8);
        String b8 = SRC_B.toString().substring(0, 8);
        List<CalibrationVariants.Row> rows = List.of(
                CalibrationVariants.row(JSON.readTree("""
                        {"q":"S:a","question":"치수와 배송","product":"%s",
                         "needs":[{"id":"n1","ask":"치수","type":"PRODUCT_SPEC"},{"id":"n2","ask":"배송","type":"POLICY"}],
                         "evidence":[{"id":"E1","kind":"PRODUCT_KNOWLEDGE","label":"치수","text":"가로 10","source":"%s","product":null}],
                         "precedents":[]}""".formatted(P1, SRC_A))),
                CalibrationVariants.row(JSON.readTree("""
                        {"q":"S:b","question":"맞나요","product":"%s",
                         "needs":[{"id":"n1","ask":"호환","type":"PRODUCT_COMPATIBILITY"}],
                         "evidence":[{"id":"E1","kind":"PRODUCT_KNOWLEDGE","label":"규격","text":"규격별 표","source":"%s","product":null}],
                         "precedents":[]}""".formatted(P2, SRC_B))),
                CalibrationVariants.row(JSON.readTree("""
                        {"q":"S:c","question":"재질","product":"%s",
                         "needs":[{"id":"n1","ask":"재질","type":"PRODUCT_SPEC"}],
                         "evidence":[{"id":"E1","kind":"PRODUCT_KNOWLEDGE","label":"재질","text":"일부","source":"%s","product":null}],
                         "precedents":[]}""".formatted(P1, SRC_A))));
        Map<String, JsonNode> gold = new HashMap<>();
        gold.put("S:a.n1", JSON.readTree("{\"sets\":[{\"refs\":[\"PK:" + a8 + "\"],\"suff\":\"FULL\"}],\"family_sets\":[]}"));
        gold.put("S:a.n2", JSON.readTree("{\"sets\":[],\"family_sets\":[]}"));
        gold.put("S:b.n1", JSON.readTree("{\"sets\":[{\"refs\":[\"PK:" + b8 + "\"],\"suff\":\"CONDITIONAL\"}],\"family_sets\":[]}"));
        gold.put("S:c.n1", JSON.readTree("{\"sets\":[{\"refs\":[\"PK:" + a8 + "\"],\"suff\":\"PARTIAL\"}],\"family_sets\":[]}"));
        return CalibrationVariants.build(rows, gold, Set.of());
    }

    static InquiryDecisionProperties props(String prompt, String effort) {
        return new InquiryDecisionProperties(true, ORG.toString(), "gpt-5-2025-08-07", "sk-test", 800, 6000, "minimal",
                prompt, effort, "json_schema");
    }

    /**
     * A vendor that answers the gold for whatever request it gets, in production shape. It recognises the request by
     * its user turn — the only thing a vendor sees — and answers every need id it was SENT, in reverse order.
     */
    static AgentLlmTransport vendor(List<CalibrationVariants.Variant> variants, InquiryDecisionProperties props,
                                    UnaryOperator<String> mutate) {
        InquiryDecisionGenerator g = new InquiryDecisionGenerator(null, props);
        Map<String, CalibrationVariants.Variant> byUserTurn = new HashMap<>();
        for (CalibrationVariants.Variant v : variants) {
            try {
                byUserTurn.put(JSON.readTree(g.judgeBody(v.question(), v.needs(), v.evidence(), v.precedents()))
                        .path("messages").path(1).path("content").asText(), v);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        return (uri, headers, json) -> {
            try {
                JsonNode req = JSON.readTree(json);
                CalibrationVariants.Variant v = byUserTurn.get(req.path("messages").path(1).path("content").asText());
                ObjectNode content = JSON.createObjectNode();
                ArrayNode verdicts = content.putArray("verdicts");
                List<InquiryNeed> reversed = new ArrayList<>(v.needs());
                java.util.Collections.reverse(reversed);
                for (InquiryNeed n : reversed) {
                    NeedStatus s = v.gold().get(n.id());
                    ObjectNode o = verdicts.addObject().put("need", n.id()).put("status", s.name());
                    ArrayNode ev = o.putArray("evidence");
                    if (s != NeedStatus.NONE) {
                        v.goldIds().get(n.id()).forEach(ev::add);
                    }
                    o.putArray("missing");
                    ArrayNode ci = o.putArray("customer_input");
                    if (s == NeedStatus.CONDITIONAL_ON_CUSTOMER) {
                        ci.add("규격");
                    }
                    o.putArray("assumptions");
                    o.putNull("ask_customer");
                    o.putArray("precedents");
                }
                String c = mutate.apply(content.toString());
                ObjectNode env = JSON.createObjectNode();
                ObjectNode choice = env.putArray("choices").addObject();
                choice.put("finish_reason", "stop");
                choice.putObject("message").put("content", c).putNull("refusal");
                env.putObject("usage").put("prompt_tokens", 100).put("completion_tokens", 20);
                return new AgentLlmTransport.Response(200, env.toString(), 3);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        };
    }

    static List<JsonNode> run(List<CalibrationVariants.Variant> vs, InquiryDecisionProperties p, UnaryOperator<String> m,
                              String arm) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String r : new CalibrationRunner(p, vendor(vs, p, m), ORG).run(arm, vs, 2, 1000, null).rows()) {
            out.add(JSON.readTree(r));
        }
        return out;
    }

    static List<JsonNode> needs(List<JsonNode> rows, String variant) {
        return rows.stream().filter(r -> "need".equals(r.path("type").asText())
                && variant.equals(r.path("variant").asText())).toList();
    }

    @Test
    @DisplayName("a vendor that answers the gold in production shape is scored exactly as the gold — ids map back, order is irrelevant")
    void productionShapedAnswersRoundTrip() throws Exception {
        List<CalibrationVariants.Variant> vs = variants();
        List<JsonNode> rows = run(vs, props(InquiryDecisionPrompt.JUDGE_V2, ""), c -> c, "B");
        List<JsonNode> orig = needs(rows, "ORIGINAL");
        assertThat(orig).hasSize(8); // 4 needs × 2 runs
        for (JsonNode r : orig) {
            assertThat(r.path("failed").asBoolean()).isFalse();
            assertThat(r.path("judged").asText()).as(r.toString()).isEqualTo(r.path("gold").asText());
            assertThat(r.path("need").asText()).as("the row names the GOLD id").matches("n\\d");
            assertThat(r.path("sent_id").asText()).as("the request carried the PRODUCTION id").matches("N\\d");
        }
        assertThat(rows.stream().filter(r -> "call".equals(r.path("type").asText()))
                .mapToLong(r -> r.path("unmatched_verdicts").asLong()).sum()).isZero();
    }

    @Test
    @DisplayName("mutations of the answer — re-cased ids, a missing, a duplicated or an invented verdict — fail the call, never score NONE")
    void mutationsFailLoudly() throws Exception {
        List<CalibrationVariants.Variant> vs = variants();
        Map<String, UnaryOperator<String>> mutations = new LinkedHashMap<>();
        mutations.put("re-cased (apr-80adf54f)", c -> c.replace("\"need\":\"N", "\"need\":\"n"));
        mutations.put("missing", c -> {
            try {
                ObjectNode o = (ObjectNode) JSON.readTree(c);
                ((ArrayNode) o.get("verdicts")).remove(0);
                return o.toString();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        mutations.put("duplicated", c -> {
            try {
                ObjectNode o = (ObjectNode) JSON.readTree(c);
                ((ArrayNode) o.get("verdicts")).add(o.get("verdicts").get(0).deepCopy());
                return o.toString();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        mutations.put("invented", c -> {
            try {
                ObjectNode o = (ObjectNode) JSON.readTree(c);
                ((ArrayNode) o.get("verdicts")).add(((ObjectNode) o.get("verdicts").get(0).deepCopy()).put("need", "N9"));
                return o.toString();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        for (Map.Entry<String, UnaryOperator<String>> m : mutations.entrySet()) {
            List<JsonNode> orig = needs(run(vs, props(InquiryDecisionPrompt.JUDGE_V2, ""), m.getValue(), "B"), "ORIGINAL");
            assertThat(orig).as(m.getKey()).allSatisfy(r -> {
                assertThat(r.path("failed").asBoolean()).isTrue();
                assertThat(r.path("failure").asText()).isEqualTo("VERDICT_SET");
                assertThat(r.path("judged").isNull()).as("a failed call carries no status — it is not a NONE").isTrue();
            });
        }
    }

    @Test
    @DisplayName("arms send byte-identical input per variant; A/B differ in instruction and schema only, B/C in effort only")
    void armFingerprints() throws Exception {
        List<CalibrationVariants.Variant> vs = variants();
        Map<String, List<JsonNode>> arms = new LinkedHashMap<>();
        arms.put("A", run(vs, props(InquiryDecisionPrompt.JUDGE_V1, "minimal"), c -> c.replaceAll(
                ",\"customer_input\":\\[[^\\]]*\\],\"assumptions\":\\[\\]", "").replace("\"missing\":[]", "\"missing\":null"), "A"));
        arms.put("B", run(vs, props(InquiryDecisionPrompt.JUDGE_V2, "minimal"), c -> c, "B"));
        arms.put("C", run(vs, props(InquiryDecisionPrompt.JUDGE_V2, "low"), c -> c, "C"));
        Map<String, Map<String, JsonNode>> calls = new HashMap<>();
        arms.forEach((arm, rows) -> {
            Map<String, JsonNode> byKey = new HashMap<>();
            rows.stream().filter(r -> "call".equals(r.path("type").asText()))
                    .forEach(r -> byKey.put(r.path("q").asText() + "|" + r.path("variant").asText() + "|"
                            + r.path("target").asText() + "|" + r.path("run").asInt(), r));
            calls.put(arm, byKey);
        });
        assertThat(calls.get("A").keySet()).isEqualTo(calls.get("B").keySet()).isEqualTo(calls.get("C").keySet());
        for (String k : calls.get("A").keySet()) {
            JsonNode a = calls.get("A").get(k);
            JsonNode b = calls.get("B").get(k);
            JsonNode c = calls.get("C").get(k);
            assertThat(a.path("input_fp")).isEqualTo(b.path("input_fp")).isEqualTo(c.path("input_fp"));
            for (String same : List.of("model", "max_tokens", "format")) {
                assertThat(a.path(same)).as(same).isEqualTo(b.path(same)).isEqualTo(c.path(same));
            }
            assertThat(a.path("system_fp")).isNotEqualTo(b.path("system_fp"));
            assertThat(b.path("system_fp")).isEqualTo(c.path("system_fp"));
            assertThat(b.path("schema_fp")).isEqualTo(c.path("schema_fp"));
            assertThat(a.path("effort")).isEqualTo(b.path("effort"));
            assertThat(b.path("effort").asText()).isEqualTo("minimal");
            assertThat(c.path("effort").asText()).isEqualTo("low");
        }
        assertThat(needs(arms.get("A"), "ORIGINAL")).allSatisfy(r -> assertThat(r.path("failed").asBoolean()).isFalse());
    }

    @Test
    @DisplayName("each variant × run is sent once and written once — no retry can double-count a sample")
    void noDoubleCounting() throws Exception {
        List<CalibrationVariants.Variant> vs = variants();
        int[] posts = {0};
        InquiryDecisionProperties p = props(InquiryDecisionPrompt.JUDGE_V2, "");
        AgentLlmTransport real = vendor(vs, p, c -> c);
        AgentLlmTransport counting = (u, h, j) -> {
            posts[0]++;
            return real.post(u, h, j);
        };
        CalibrationRunner.Result r = new CalibrationRunner(p, counting, ORG).run("B", vs, 2, 1000, null);
        long modelCalls = vs.stream().filter(CalibrationVariants.Variant::needsModel)
                .mapToLong(v -> v.kind() == CalibrationVariants.Kind.ORIGINAL ? 2 : 1).sum();
        assertThat(posts[0]).isEqualTo(modelCalls).isEqualTo(r.calls());
        List<String> keys = r.rows().stream().map(s -> {
            try {
                JsonNode n = JSON.readTree(s);
                return n.path("type").asText() + "|" + n.path("run").asInt() + "|" + n.path("q").asText() + "|"
                        + n.path("variant").asText() + "|" + n.path("target").asText() + "|" + n.path("need").asText();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }).toList();
        assertThat(keys).doesNotHaveDuplicates();
    }
}
