package com.sellerops.agent.llm.operator;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The vendor wire format, and NOTHING about what is being asked.
 *
 * <p>Factored out because the Operator adds two more LLM capabilities (plan, judge) beside the
 * existing draft one, and each must keep its OWN payload floor, its own prompt and its own
 * assertable {@code requestBody}. Duplicating the Anthropic/OpenAI envelope three times would have
 * meant three places to get {@code max_tokens} vs {@code max_completion_tokens} wrong; folding the
 * prompts in here would have meant one method holding three payload floors, which is exactly the
 * merge {@code AgentDraftBoundaryTest} exists to prevent.
 *
 * <p>So the split is: this class knows how to phrase a system turn and a user turn for a vendor, and
 * knows nothing about inquiries, plans or findings. Each generator still owns the strings it passes
 * and still builds its own request body, so each payload floor is still asserted on its own bytes.
 *
 * <p>Pure: no transport, no key, no clock. The API key lives in the header map a generator builds.
 */
public final class AgentLlmWireFormat {

    /** Which wire format to speak. Nothing else differs between them. */
    public enum Vendor {
        ANTHROPIC("https://api.anthropic.com/v1/messages"),
        OPENAI("https://api.openai.com/v1/chat/completions");

        private final String endpoint;

        Vendor(String endpoint) {
            this.endpoint = endpoint;
        }

        public java.net.URI endpoint() {
            return java.net.URI.create(endpoint);
        }

        /** {@code ANTHROPIC} when the configured name says so; OpenAI otherwise — the draft capability's rule. */
        public static Vendor of(String name) {
            return "ANTHROPIC".equalsIgnoreCase(name) ? ANTHROPIC : OPENAI;
        }
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AgentLlmWireFormat() {
    }

    /**
     * A chat request carrying exactly one system turn and one user turn.
     *
     * <p>{@code json_object} response format is requested from OpenAI as the draft capability does:
     * it guarantees SYNTAX, never the schema, so every caller still validates every field itself.
     */
    public static String body(Vendor vendor, String modelId, String system, String user,
                              int maxOutputTokens, String reasoningEffort) {
        return body(vendor, modelId, system, user, maxOutputTokens, reasoningEffort, null);
    }

    /**
     * The same body, with the caller's own response format.
     *
     * <p>Most capabilities ask for {@code json_object} and read the answer strictly themselves. One asks for
     * <b>strict Structured Outputs</b> — a json_schema the vendor enforces — because its contract is a closed
     * vocabulary and «the model may not say PROCEDURE» is worth making structural rather than checking afterwards.
     * A null format keeps the historical bytes exactly, so nothing that did not ask for this changed.
     */
    public static String body(Vendor vendor, String modelId, String system, String user,
                              int maxOutputTokens, String reasoningEffort, ObjectNode responseFormat) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", modelId);
        ArrayNode messages = root.putArray("messages");
        ObjectNode userTurn = messages.addObject();
        userTurn.put("role", "user");
        userTurn.put("content", user);
        if (vendor == Vendor.ANTHROPIC) {
            root.put("max_tokens", maxOutputTokens);
            root.put("system", system);
        } else {
            root.put("max_completion_tokens", maxOutputTokens);
            if (responseFormat == null) {
                root.putObject("response_format").put("type", "json_object");
            } else {
                root.set("response_format", responseFormat);
            }
            if (reasoningEffort != null) {
                root.put("reasoning_effort", reasoningEffort);
            }
            ObjectNode systemTurn = messages.insertObject(0);
            systemTurn.put("role", "system");
            systemTurn.put("content", system);
        }
        return root.toString();
    }

    /** Auth headers for the vendor. The key is never logged and never reaches a result object. */
    public static Map<String, String> headers(Vendor vendor, String apiKey) {
        Map<String, String> headers = new LinkedHashMap<>();
        if (vendor == Vendor.ANTHROPIC) {
            headers.put("x-api-key", apiKey);
            headers.put("anthropic-version", "2023-06-01");
        } else {
            headers.put("Authorization", "Bearer " + apiKey);
        }
        return headers;
    }
}
