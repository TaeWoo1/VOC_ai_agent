package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmCallMetrics;
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
        List<InquiryNeed> needs = response.ok() ? parsePlan(content(response)) : null;
        log.info("inquiry_decision phase=plan orgId={} answered={} needs={} {}", orgId, response.ok(),
                needs == null ? -1 : needs.size(), metrics.toLogFields());
        return new InquiryDecisionModel.Answer<>(needs, cost(metrics));
    }

    InquiryDecisionModel.Answer<Map<String, NeedVerdict>> judge(UUID orgId, String body, int needs, int evidence,
                                                                int precedents) {
        AgentLlmTransport.Response response = transport.post(ENDPOINT,
                Map.of("Authorization", "Bearer " + properties.apiKey()), body);
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(response);
        Map<String, NeedVerdict> verdicts = response.ok() ? parseJudge(content(response)) : null;
        log.info("inquiry_decision phase=judge orgId={} prompt={} effort={} answered={} needs={} evidence={} precedents={}"
                        + " verdicts={} {}", orgId, properties.judgePrompt(), properties.judgeReasoningEffort(),
                response.ok(), needs, evidence, precedents, verdicts == null ? -1 : verdicts.size(),
                metrics.toLogFields());
        return new InquiryDecisionModel.Answer<>(verdicts, cost(metrics));
    }

    private static InquiryDecisionModel.CallCost cost(AgentLlmCallMetrics m) {
        return new InquiryDecisionModel.CallCost(1, m.elapsedMs(), m.promptTokens(), m.completionTokens());
    }

    private static String content(AgentLlmTransport.Response response) {
        try {
            return MAPPER.readTree(response.body()).path("choices").path(0).path("message").path("content").asText("");
        } catch (Exception e) {
            return "";
        }
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
                properties.planMaxOutputTokens(), properties.reasoningEffort());
    }

    String judgeBody(String question, List<InquiryNeed> needs, List<EvidenceCandidate> evidence,
                     List<PrecedentCandidate> precedents) {
        return body(InquiryDecisionPrompt.judgeSystem(properties.judgePrompt()),
                InquiryDecisionPrompt.judgeUser(question, needs, evidence, precedents),
                properties.judgeMaxOutputTokens(), properties.judgeReasoningEffort());
    }

    private String body(String system, String user, int maxTokens, String reasoningEffort) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", properties.model());
        ArrayNode messages = root.putArray("messages");
        messages.addObject().put("role", "system").put("content", system);
        messages.addObject().put("role", "user").put("content", user);
        root.put("max_completion_tokens", maxTokens);
        root.putObject("response_format").put("type", "json_object");
        if (reasoningEffort != null) {
            root.put("reasoning_effort", reasoningEffort);
        }
        return root.toString();
    }
}
