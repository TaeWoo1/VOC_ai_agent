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

    /**
     * Every knob this classifier sets on the request, in one place, because RUBRIC v2 §8.6 makes all
     * of them part of what produced a result.
     *
     * <p>They are a record rather than four constructor parameters so that adding one has to go
     * through {@link #suffix()} — a knob that changed the request without changing the version would
     * let two different candidates be measured under one name, which is the failure §8.6 exists to
     * prevent.
     *
     * @param pinTemperature  pin {@code temperature: 0}. Reproducibility depends on it, and without
     *     it the change log compares runs that were never the same experiment. But some models
     *     reject any temperature but their own default and answer a pinned one with a 400, which
     *     this classifier faithfully turns into {@code CLASSIFICATION_FAILED} on every row — visible,
     *     and a wasted run. It is <b>not</b> retried without the field on a 400: a retry that changed
     *     the request would be a second candidate wearing the first one's name.
     * @param maxOutputTokens the output budget. On a reasoning model this budget is shared with the
     *     model's internal reasoning, so a budget sized for the answer alone can be spent entirely
     *     before any answer is emitted — arriving here as an empty message and, correctly but
     *     uselessly, {@code UNCLASSIFIED} on every row.
     * @param reasoningEffort OpenAI only, null to omit. Lower effort leaves more of the budget for
     *     the answer and costs less; whether that trades away accuracy is a thing to measure on
     *     {@code DEV}, one fixed value per run, not to assume.
     */
    public record Tuning(boolean pinTemperature, int maxOutputTokens, String reasoningEffort) {

        public static final Tuning DEFAULT = new Tuning(true, 300, null);

        String suffix() {
            return (pinTemperature ? "+t0" : "+tdefault") + "+out" + maxOutputTokens
                    + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
        }
    }

    private final LlmHttpClient http;
    private final Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final Tuning tuning;
    private final String version;

    public ApiTriageClassifier(LlmHttpClient http, Vendor vendor, String modelId, String apiKey) {
        this(http, vendor, modelId, apiKey, Tuning.DEFAULT);
    }

    public ApiTriageClassifier(LlmHttpClient http, Vendor vendor, String modelId, String apiKey,
                               Tuning tuning) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.tuning = tuning;
        // RUBRIC v2 §8.8's table, in one string. A reader of a stored prediction can tell exactly
        // what produced it without consulting anything else. The additive guard is in it because the guard is
        // part of what decides the tier, so it is part of what produced the result.
        this.version = "llm-triage/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + TriagePrompt.PROMPT_VERSION + "+schema/v1" + tuning.suffix()
                + "+" + AdditiveTriageDecision.GUARD_VERSION;
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
        JsonNode envelope;
        try {
            envelope = MAPPER.readTree(response.body());
        } catch (Exception e) {
            return Result.failed(version, "unreadable response envelope");
        }
        String stop = stopReason(envelope);
        if ("length".equals(stop) || "max_tokens".equals(stop)) {
            // Named rather than left to surface as "empty response". On a reasoning model the output
            // budget is shared with internal reasoning, so this is the difference between "the model
            // cannot do the task" and "the budget was too small" — and one of those is fixable by
            // raising Tuning.maxOutputTokens rather than by abandoning the candidate.
            return Result.failed(version, "output budget exhausted before an answer (" + stop + ")");
        }
        String text = extractText(envelope);
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
        if (tuning.pinTemperature()) {
            root.put("temperature", 0);
        }
        ArrayNode messages = root.putArray("messages");
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        user.put("content", TriagePrompt.userTurn(input.rating(), input.body()));
        if (vendor == Vendor.ANTHROPIC) {
            root.put("max_tokens", tuning.maxOutputTokens());
            root.put("system", TriagePrompt.SYSTEM);
        } else {
            root.put("max_completion_tokens", tuning.maxOutputTokens());
            root.putObject("response_format").put("type", "json_object");
            if (tuning.reasoningEffort() != null) {
                root.put("reasoning_effort", tuning.reasoningEffort());
            }
            ObjectNode system = messages.insertObject(0);
            system.put("role", "system");
            system.put("content", TriagePrompt.SYSTEM);
        }
        return root.toString();
    }

    /**
     * Why the model stopped, from whichever field the vendor calls it.
     *
     * <p>A vendor-controlled enum, not free text, so it can be quoted in a failure reason without
     * carrying anything about the review.
     */
    private String stopReason(JsonNode envelope) {
        return vendor == Vendor.ANTHROPIC
                ? envelope.path("stop_reason").asText(null)
                : envelope.path("choices").path(0).path("finish_reason").asText(null);
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
