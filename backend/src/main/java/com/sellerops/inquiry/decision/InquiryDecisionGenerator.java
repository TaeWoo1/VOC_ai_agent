package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmCallMetrics;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.resolution.ResolutionPlan;
import com.sellerops.inquiry.resolution.ResolutionPlanParser;
import com.sellerops.inquiry.resolution.ResolutionPlannerPrompt;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The two calls Inquiry Decision v2 makes, and the only class that holds this capability's transport — constructed
 * only by {@link InquiryDecisionService}.
 *
 * <p><b>The payload floor.</b> Planning sends the model, the fixed instruction and the customer's message. Judging
 * sends the same message, the needs, the candidate evidence and the past answers — each by POSITION ({@code N1},
 * {@code E1}, {@code P1}) with no source id, no product id, no organisation and no customer identifier.
 * {@code InquiryDecisionPayloadFloorTest} asserts the bytes.
 *
 * <p>Logged: metadata only (counts, whether it answered, time, tokens). Never a sentence.
 */
public class InquiryDecisionGenerator {

    private static final URI ENDPOINT = URI.create("https://api.openai.com/v1/chat/completions");
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Logger log = LoggerFactory.getLogger(InquiryDecisionGenerator.class);
    static final int MAX_ASK = 120;

    private final AgentLlmTransport transport;
    private final InquiryDecisionProperties properties;

    InquiryDecisionGenerator(AgentLlmTransport transport, InquiryDecisionProperties properties) {
        this.transport = transport;
        this.properties = properties;
    }

    InquiryDecisionModel.Answer<List<InquiryNeed>> plan(UUID orgId, String body) {
        AgentLlmTransport.Response response = transport.post(ENDPOINT,
                Map.of("Authorization", "Bearer " + properties.apiKey()), body);
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(response);
        Envelope env = Envelope.of(response);
        List<InquiryNeed> needs = env.failure() == null ? parsePlan(env.content()) : null;
        String failure = env.failure() != null ? env.failure() : needs == null ? "UNPARSEABLE" : null;
        log.info("inquiry_decision phase=plan orgId={} format={} answered={} failure={} finish={} needs={} {}", orgId,
                properties.outputFormat(), failure == null, failure, env.finish(), needs == null ? -1 : needs.size(),
                metrics.toLogFields());
        return new InquiryDecisionModel.Answer<>(needs, cost(metrics), failure);
    }

    /**
     * @param needIds the ids the request sent, in order — the verdict set must be exactly these ({@link #parseJudge(String,
     *                List)}): one each, none missing, none duplicated, none invented. Anything else fails the call.
     */
    InquiryDecisionModel.Answer<Map<String, NeedVerdict>> judge(UUID orgId, String body, List<String> needIds,
                                                                int evidence, int precedents) {
        AgentLlmTransport.Response response = transport.post(ENDPOINT,
                Map.of("Authorization", "Bearer " + properties.apiKey()), body);
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(response);
        Envelope env = Envelope.of(response);
        Judged judged = env.failure() == null ? parseJudge(env.content(), needIds) : new Judged(null, env.failure());
        log.info("inquiry_decision phase=judge orgId={} prompt={} effort={} format={} answered={} failure={} finish={}"
                        + " needs={} evidence={} precedents={} verdicts={} {}", orgId, properties.judgePrompt(),
                properties.judgeReasoningEffort(), properties.outputFormat(), judged.failure() == null,
                judged.failure(), env.finish(), needIds.size(), evidence, precedents,
                judged.verdicts() == null ? -1 : judged.verdicts().size(), metrics.toLogFields());
        return new InquiryDecisionModel.Answer<>(judged.verdicts(), cost(metrics), judged.failure());
    }

    /**
     * <b>The Resolution Planner call</b> (Inquiry v3 WP-2) — the same capability, key and transport as the v2 planner, and
     * a different instruction, schema and parser. The raw content is returned beside the plan: a shadow run records what
     * the model actually said, and an observation nobody can re-derive is the one thing a re-run cannot replace.
     */
    ResolutionPlanCall resolutionPlan(UUID orgId, String body) {
        AgentLlmTransport.Response response = transport.post(ENDPOINT,
                Map.of("Authorization", "Bearer " + properties.apiKey()), body);
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(response);
        Envelope env = Envelope.of(response);
        ResolutionPlanParser.Parsed parsed = env.failure() == null ? ResolutionPlanParser.parse(env.content())
                : ResolutionPlanParser.failed(env.failure());
        log.info("inquiry_decision phase=resolution_plan orgId={} prompt={} format={} answered={} failure={} finish={}"
                        + " needs={} {}", orgId, ResolutionPlannerPrompt.VERSION, properties.outputFormat(),
                parsed.failure() == null, parsed.failure(), env.finish(),
                parsed.plan() == null ? -1 : parsed.plan().needs().size(), metrics.toLogFields());
        return new ResolutionPlanCall(env.content(), env.said(), env.finish(), parsed.plan(), parsed.failure(),
                cost(metrics));
    }

    /**
     * What one planner call produced: the answer that may be read as a plan ({@code content}, null unless the call
     * succeeded), what the vendor actually sent ({@code said}, kept even when it may not be read — see
     * {@link Envelope}), the plan when there was one, and what it cost.
     */
    record ResolutionPlanCall(String content, String said, String finish, ResolutionPlan plan, String failure,
                              InquiryDecisionModel.CallCost cost) {
    }

    String resolutionPlanBody(String question, CapabilitySnapshot snapshot) {
        return body(ResolutionPlannerPrompt.system(), ResolutionPlannerPrompt.user(question, snapshot),
                ResolutionPlannerPrompt.MAX_OUTPUT_TOKENS, properties.reasoningEffort(),
                ResolutionPlannerPrompt.schema(snapshot));
    }

    /**
     * What came back, before any parsing of the model's content. A refusal, a cut-off answer, an HTTP failure and an
     * empty message are different facts and are recorded as such — each is still no opinion (fail closed).
     *
     * <p><b>Two content fields, because there are two questions</b> (Inquiry v3 WP-3.1). {@code content} answers "may
     * this be read as a plan": it is non-null only when {@code failure} is null, so every fail-closed caller above is
     * unchanged by construction. {@code said} answers "what did the vendor actually send", and is filled in
     * <i>every</i> case where something came back at all — the truncated prefix, the refusal sentence, the unreadable
     * envelope's own body.
     *
     * <p>Until WP-3.1 the second question had no field and therefore no answer. The 67-call shadow of 2026-09-20 hit
     * {@code finish=length} four times, each returning exactly 1,600 output tokens where the same four questions had
     * produced 153–347 under v2 — and the partial content, the only evidence of why, was discarded one line after it
     * was read. <b>Those four are not recoverable and this field does not claim to recover them</b>; it makes the next
     * one observable.
     *
     * <p><b>{@code said} is evidence and never an input to a plan.</b> Nothing repairs, completes or parses it. A
     * truncated JSON object mended into a plan would be a plan the model never finished writing, and the authority set
     * of a half-written plan is not a smaller version of the right answer — it is an unknown one.
     */
    record Envelope(String content, String said, String finish, String failure) {
        static Envelope of(AgentLlmTransport.Response response) {
            if (response == null) {
                return new Envelope(null, null, null, "TRANSPORT");
            }
            if (!response.ok()) {
                // the vendor's own error body is the only evidence of an HTTP failure, so that is what `said` carries
                return new Envelope(null, blankToNull(response.body()), null,
                        response.status() == 0 ? "TRANSPORT" : "HTTP_" + response.status());
            }
            try {
                JsonNode choice = MAPPER.readTree(response.body()).path("choices").path(0);
                String finish = choice.path("finish_reason").asText(null);
                String said = choice.path("message").path("content").asText("");
                JsonNode refusal = choice.path("message").path("refusal");
                if (refusal.isTextual() && !refusal.asText().isBlank()) {
                    return new Envelope(null, refusal.asText(), finish, "REFUSAL");
                }
                if ("length".equals(finish)) {
                    return new Envelope(null, blankToNull(said), finish, "TRUNCATED");
                }
                return said.isBlank() ? new Envelope(null, null, finish, "EMPTY")
                        : new Envelope(said, said, finish, null);
            } catch (Exception e) {
                return new Envelope(null, blankToNull(response.body()), null, "UNPARSEABLE");
            }
        }

        private static String blankToNull(String s) {
            return s == null || s.isBlank() ? null : s;
        }
    }

    /** A verdict set, or why there is none. */
    record Judged(Map<String, NeedVerdict> verdicts, String failure) {
    }

    private static InquiryDecisionModel.CallCost cost(AgentLlmCallMetrics m) {
        return new InquiryDecisionModel.CallCost(1, m.elapsedMs(), m.promptTokens(), m.completionTokens());
    }

    /**
     * The needs, renumbered by position. <b>Any need with an unknown type fails the whole plan</b>: dropping one would
     * leave a need the judge never saw, and a Case could then be completed without it.
     */
    static List<InquiryNeed> parsePlan(String content) {
        try {
            if (content == null || content.isBlank()) {
                return null;
            }
            JsonNode needs = MAPPER.readTree(content).path("needs");
            if (!needs.isArray()) {
                return null;
            }
            List<InquiryNeed> out = new ArrayList<>();
            for (JsonNode n : needs) {
                NeedType type = NeedType.parse(n.path("type").asText(null));
                String ask = n.path("ask").asText("").strip();
                if (type == null || ask.isEmpty()) {
                    return null;
                }
                if (ask.length() > MAX_ASK) {
                    ask = ask.substring(0, MAX_ASK);
                }
                String search = n.path("search").asText("").strip();
                out.add(new InquiryNeed("N" + (out.size() + 1), ask, type, search.isEmpty() ? ask : search));
            }
            return List.copyOf(out);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * <b>The verdict set must be exactly the needs sent</b> (Inquiry Decision v2.1 audit). Verdicts are matched by id,
     * so their order does not matter; but a missing need, a need judged twice, an id that was never sent or a verdict
     * that cannot be read FAILS THE CALL ({@code VERDICT_SET}) rather than being skipped. Before this, a missing verdict
     * silently became NONE, a duplicate silently kept the last word (a NONE could be overwritten by a FULL), and an
     * unknown id was ignored — the same silent mapping failure that invalidated calibration run apr-80adf54f. The
     * product outcome of a failed judge is unchanged: NO_ANSWER_BASIS, the Case is the seller's.
     */
    static Judged parseJudge(String content, List<String> needIds) {
        if (content == null || content.isBlank()) {
            return new Judged(null, "EMPTY");
        }
        JsonNode verdicts;
        try {
            verdicts = MAPPER.readTree(content).path("verdicts");
        } catch (Exception e) {
            return new Judged(null, "UNPARSEABLE");
        }
        if (!verdicts.isArray()) {
            return new Judged(null, "UNPARSEABLE");
        }
        Set<String> expected = new HashSet<>(needIds);
        Set<String> seen = new HashSet<>();
        for (JsonNode v : verdicts) {
            String need = v.path("need").asText("");
            if (!expected.contains(need) || !seen.add(need)
                    || NeedStatus.parseJudge(v.path("status").asText(null)) == null) {
                return new Judged(null, "VERDICT_SET");
            }
        }
        if (!seen.equals(expected)) {
            return new Judged(null, "VERDICT_SET");
        }
        return new Judged(parseJudge(content), null);
    }

    /** Lenient reading of one answer's verdicts, by id — the strict set check is {@link #parseJudge(String, List)}. */
    static Map<String, NeedVerdict> parseJudge(String content) {
        try {
            if (content == null || content.isBlank()) {
                return null;
            }
            JsonNode verdicts = MAPPER.readTree(content).path("verdicts");
            if (!verdicts.isArray()) {
                return null;
            }
            Map<String, NeedVerdict> out = new LinkedHashMap<>();
            for (JsonNode v : verdicts) {
                String need = v.path("need").asText("");
                NeedStatus status = NeedStatus.parseJudge(v.path("status").asText(null));
                if (need.isEmpty() || status == null) {
                    continue; // an unparseable verdict is no verdict — the need stays NONE
                }
                out.put(need, new NeedVerdict(need, status, strings(v.path("evidence")), phrases(v.path("missing")),
                        strings(v.path("customer_input")), strings(v.path("assumptions")), text(v, "ask_customer"),
                        strings(v.path("precedents"))));
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private static List<String> strings(JsonNode array) {
        Set<String> out = new HashSet<>();
        List<String> ordered = new ArrayList<>();
        if (array.isArray()) {
            for (JsonNode x : array) {
                String s = x.asText("").strip();
                if (!s.isEmpty() && out.add(s)) {
                    ordered.add(s);
                }
            }
        }
        return List.copyOf(ordered);
    }

    /** v2 writes a list; v1 wrote one sentence. Either is read as the list of what is missing. */
    private static List<String> phrases(JsonNode node) {
        if (node.isTextual()) {
            String s = node.asText("").strip();
            return s.isEmpty() ? List.of() : List.of(s);
        }
        return strings(node);
    }

    private static String text(JsonNode v, String field) {
        String s = v.path(field).asText("").strip();
        return s.isEmpty() ? null : s;
    }

    /** Package-visible so the payload floor test can assert the exact bytes. */
    String planBody(String question) {
        return body(InquiryDecisionPrompt.planSystem(), InquiryDecisionPrompt.planUser(question),
                properties.planMaxOutputTokens(), properties.reasoningEffort(), InquiryDecisionPrompt.planSchema());
    }

    String judgeBody(String question, List<InquiryNeed> needs, List<EvidenceCandidate> evidence,
                     List<PrecedentCandidate> precedents) {
        return body(InquiryDecisionPrompt.judgeSystem(properties.judgePrompt()),
                InquiryDecisionPrompt.judgeUser(question, needs, evidence, precedents),
                properties.judgeMaxOutputTokens(), properties.judgeReasoningEffort(),
                InquiryDecisionPrompt.judgeSchema(properties.judgePrompt(), needs.stream().map(InquiryNeed::id).toList(),
                        evidence.stream().map(EvidenceCandidate::id).toList(),
                        precedents.stream().map(PrecedentCandidate::id).toList()));
    }

    private String body(String system, String user, int maxTokens, String reasoningEffort, ObjectNode schema) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", properties.model());
        ArrayNode messages = root.putArray("messages");
        messages.addObject().put("role", "system").put("content", system);
        messages.addObject().put("role", "user").put("content", user);
        root.put("max_completion_tokens", maxTokens);
        if (InquiryDecisionProperties.FORMAT_JSON_OBJECT.equals(properties.outputFormat())) {
            root.putObject("response_format").put("type", "json_object"); // the v2 / apr-c8715d20 request shape
        } else {
            root.set("response_format", schema);
        }
        if (reasoningEffort != null) {
            root.put("reasoning_effort", reasoningEffort);
        }
        return root.toString();
    }
}
