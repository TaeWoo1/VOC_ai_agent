package com.sellerops.review.triage.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The production classifier: one API call per review, over {@link LlmHttpClient}.
 *
 * <p><b>Two vendors, one class.</b> The vendor is an open product-owner decision
 * ({@code docs/slices/llm-triage-classifier-v1.md} §7) and the pilot's GPT result was a consumer
 * subscription, which says nothing about an API model. Both wire formats are therefore built, so
 * that decision stays a configuration rather than becoming whichever adapter got written first. The
 * differences between them are three lines of JSON and one path into the response; a second class
 * would have duplicated the payload floor, which is the part that must not be duplicated.
 *
 * <p><b>The payload floor lives here</b> (RUBRIC v2 §8.3/§8.4). {@link #requestBody} is the only
 * place a request is constructed, it reads exactly two values off {@link Input}, and
 * {@code TriagePayloadFloorTest} asserts the serialized bytes rather than this method's intent.
 *
 * <p>The API key is read once at construction and never logged, never echoed in a failure reason,
 * and never placed anywhere a {@code Result} can reach.
 */
public class ApiTriageClassifier implements ReviewTriageClassifier {

    /** Which wire format to speak. Nothing else differs between them. */
    public enum Vendor {
        ANTHROPIC(URI.create("https://api.anthropic.com/v1/messages")),
        OPENAI(URI.create("https://api.openai.com/v1/chat/completions"));

        private final URI endpoint;

        Vendor(URI endpoint) {
            this.endpoint = endpoint;
        }
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int MAX_OUTPUT_TOKENS = 300;

    private final LlmHttpClient http;
    private final Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final boolean sendTemperature;
    private final String version;

    public ApiTriageClassifier(LlmHttpClient http, Vendor vendor, String modelId, String apiKey) {
        this(http, vendor, modelId, apiKey, true);
    }

    /**
     * @param sendTemperature whether to pin {@code temperature: 0}.
     *
     *     <p>Configurable rather than always-on because some models reject any temperature but their
     *     default and answer a pinned one with a 400 — which this classifier would faithfully turn
     *     into {@code CLASSIFICATION_FAILED} on every single row. Visible, but a waste of a run.
     *
     *     <p>It is <b>not</b> silently retried without the field. A retry that changed the request
     *     would mean two different candidates were measured under one name, and the whole point of
     *     RUBRIC v2 §8.6 is that a version names exactly what produced a result. So the flag is
     *     explicit, and it goes into {@link #version()}: a run at pinned zero and a run at the
     *     model's default are different candidates and the change log has to be able to say which.
     */
    public ApiTriageClassifier(LlmHttpClient http, Vendor vendor, String modelId, String apiKey,
                               boolean sendTemperature) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.sendTemperature = sendTemperature;
        // All of RUBRIC §8.6's components in one string: the vendor and model, the prompt version,
        // the schema the parser enforces, and the one sampling knob this classifier sets. A reader
        // of a stored prediction can tell exactly what produced it without consulting anything else.
        this.version = "llm-triage/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + TriagePrompt.PROMPT_VERSION + "+schema/v1"
                + (sendTemperature ? "+t0" : "+tdefault");
    }

    @Override
    public String version() {
        return version;
    }

    @Override
    public Result classify(Input input) {
        String body = requestBody(input);
        LlmHttpClient.Response response = http.post(vendor.endpoint, headers(), body);
        if (response.status() == 0) {
            // Transport-level: connect failure, timeout, interruption. §8.5's CLASSIFICATION_FAILED.
            return Result.failed(version, "transport: " + response.body());
        }
        if (!response.ok()) {
            // The status only. A vendor error body can quote the request, and the request contains
            // the review.
            return Result.failed(version, "http " + response.status());
        }
        String text;
        try {
            text = extractText(MAPPER.readTree(response.body()));
        } catch (Exception e) {
            return Result.failed(version, "unreadable response envelope");
        }
        if (text == null) {
            return Result.failed(version, "response envelope carried no message text");
        }
        return TriageResponseParser.parse(text, version);
    }

    private Map<String, String> headers() {
        Map<String, String> headers = new LinkedHashMap<>();
        if (vendor == Vendor.ANTHROPIC) {
            headers.put("x-api-key", apiKey);
            headers.put("anthropic-version", "2023-06-01");
        } else {
            headers.put("Authorization", "Bearer " + apiKey);
        }
        return headers;
    }

    /**
     * The whole outgoing payload, built from a rating and a body and nothing else.
     *
     * <p>Package-private so the payload-floor test can assert the exact string. That test is the
     * mechanism §8.4 asks for: a check on what this method <i>meant</i> to send would keep passing
     * after someone added a field to improve a number.
     */
    String requestBody(Input input) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", modelId);
        if (sendTemperature) {
            // Zero temperature is not a quality choice — it is what makes a DEV result reproducible,
            // without which §8.6's change log compares runs that were never the same experiment.
            root.put("temperature", 0);
        }
        ArrayNode messages = root.putArray("messages");
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        user.put("content", TriagePrompt.userTurn(input.rating(), input.body()));
        if (vendor == Vendor.ANTHROPIC) {
            root.put("max_tokens", MAX_OUTPUT_TOKENS);
            root.put("system", TriagePrompt.SYSTEM);
        } else {
            root.put("max_completion_tokens", MAX_OUTPUT_TOKENS);
            root.putObject("response_format").put("type", "json_object");
            ObjectNode system = messages.insertObject(0);
            system.put("role", "system");
            system.put("content", TriagePrompt.SYSTEM);
        }
        return root.toString();
    }

    private String extractText(JsonNode envelope) {
        if (vendor == Vendor.ANTHROPIC) {
            for (JsonNode block : envelope.path("content")) {
                if ("text".equals(block.path("type").asText())) {
                    return block.path("text").asText(null);
                }
            }
            return null;
        }
        return envelope.path("choices").path(0).path("message").path("content").asText(null);
    }
}
