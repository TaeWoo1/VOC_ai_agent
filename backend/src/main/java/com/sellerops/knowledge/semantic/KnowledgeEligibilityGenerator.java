package com.sellerops.knowledge.semantic;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The one call the evidence-eligibility capability makes.
 *
 * <p><b>The payload floor.</b> What leaves is the model, the output settings, the fixed instruction,
 * the customer's sentence and the candidate passages — the passages by POSITION, with no source id,
 * no chunk id, no product, no organisation and no seller name, because a judgement about whether a
 * fact is present needs none of them and a request that carries an identifier is a request that can
 * leak one. {@code KnowledgeEligibilityPayloadFloorTest} asserts the serialized bytes.
 *
 * <p>One door: the only class that may hold the transport for this capability, constructed only by
 * {@link KnowledgeEvidenceEligibility}.
 */
public class KnowledgeEligibilityGenerator {

    private static final URI ENDPOINT = URI.create("https://api.openai.com/v1/chat/completions");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport transport;
    private final KnowledgeEligibilityProperties properties;

    KnowledgeEligibilityGenerator(AgentLlmTransport transport,
                                  KnowledgeEligibilityProperties properties) {
        this.transport = transport;
        this.properties = properties;
    }

    /**
     * Which of these passages carry a fact for this question, by position.
     *
     * @return an empty map when the vendor refused or answered a shape this does not recognise —
     *         and then nothing is refused, because a judge that did not answer has no opinion
     */
    Map<Integer, Boolean> judge(String question, List<String> passages) {
        AgentLlmTransport.Response response = transport.post(ENDPOINT,
                Map.of("Authorization", "Bearer " + properties.apiKey()),
                requestBody(question, passages));
        if (!response.ok()) {
            return Map.of();
        }
        try {
            String content = MAPPER.readTree(response.body())
                    .path("choices").path(0).path("message").path("content").asText("");
            if (content.isBlank()) {
                return Map.of();
            }
            Map<Integer, Boolean> out = new HashMap<>();
            for (JsonNode verdict : MAPPER.readTree(content).path("verdicts")) {
                int index = verdict.path("i").asInt(-1);
                if (index >= 0 && index < passages.size() && verdict.has("supports")) {
                    out.put(index, verdict.path("supports").asBoolean());
                }
            }
            return out;
        } catch (Exception e) {
            return Map.of();
        }
    }

    /** Package-visible so the payload floor test can assert the exact bytes that leave. */
    String requestBody(String question, List<String> passages) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", properties.model());
        ArrayNode messages = root.putArray("messages");
        ObjectNode system = messages.addObject();
        system.put("role", "system");
        system.put("content", KnowledgeEligibilityPrompt.system());
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        user.put("content", KnowledgeEligibilityPrompt.user(question, passages));
        root.put("max_completion_tokens", properties.maxOutputTokens());
        root.putObject("response_format").put("type", "json_object");
        if (properties.reasoningEffort() != null) {
            root.put("reasoning_effort", properties.reasoningEffort());
        }
        return root.toString();
    }
}
