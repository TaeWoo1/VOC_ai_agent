package com.sellerops.knowledge.semantic;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.util.Map;

/**
 * The one call the retrieval-intent capability makes.
 *
 * <p><b>The payload floor.</b> What leaves is the model, the two prompt turns, and the output
 * settings — and the only variable content in either turn is the customer's own sentence. No
 * organisation, no product, no identifier, no seller passage; the request has nowhere to put them
 * and this class does not invent a place. {@code KnowledgeQuestionIntentPayloadFloorTest} asserts
 * the serialized bytes.
 *
 * <p>One door, in the shape {@code AgentDraftBoundaryTest} fixes for every capability: the only
 * class that may hold the transport for this capability, constructed only by
 * {@link KnowledgeQuestionIntent}, so the organisation gate is checked at the door.
 */
public class KnowledgeQuestionIntentGenerator {

    /** A restatement longer than the question it restates is not a restatement. */
    static final int MAX_INTENT_CHARS = 200;

    private static final URI ENDPOINT = URI.create("https://api.openai.com/v1/chat/completions");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport transport;
    private final KnowledgeQuestionIntentProperties properties;

    KnowledgeQuestionIntentGenerator(AgentLlmTransport transport,
                                     KnowledgeQuestionIntentProperties properties) {
        this.transport = transport;
        this.properties = properties;
    }

    /**
     * What this sentence needs to be answered, as a sentence to embed beside it.
     *
     * @return null when the vendor refused, answered a shape this does not recognise, or said the
     *         sentence asks for nothing. <b>Null is a real answer</b>: the search then runs on the
     *         customer's own words exactly as it did before this capability existed.
     */
    String intentOf(String question) {
        AgentLlmTransport.Response response = transport.post(ENDPOINT,
                Map.of("Authorization", "Bearer " + properties.apiKey()), requestBody(question));
        if (!response.ok()) {
            return null;
        }
        try {
            JsonNode root = MAPPER.readTree(response.body());
            String content = root.path("choices").path(0).path("message").path("content").asText("");
            if (content.isBlank()) {
                return null;
            }
            String intent = MAPPER.readTree(content).path("intent").asText("").strip();
            if (intent.isEmpty() || intent.length() > MAX_INTENT_CHARS) {
                return null;
            }
            return intent;
        } catch (Exception e) {
            return null;
        }
    }

    /** Package-visible so the payload floor test can assert the exact bytes that leave. */
    String requestBody(String question) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", properties.model());
        ArrayNode messages = root.putArray("messages");
        ObjectNode system = messages.addObject();
        system.put("role", "system");
        system.put("content", KnowledgeQuestionIntentPrompt.system());
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        user.put("content", KnowledgeQuestionIntentPrompt.user(question));
        root.put("max_completion_tokens", properties.maxOutputTokens());
        root.putObject("response_format").put("type", "json_object");
        if (properties.reasoningEffort() != null) {
            root.put("reasoning_effort", properties.reasoningEffort());
        }
        return root.toString();
    }
}
