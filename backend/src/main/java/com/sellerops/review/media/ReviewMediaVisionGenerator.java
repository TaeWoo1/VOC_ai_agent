package com.sellerops.review.media;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * One review photo, one call — the review-photo vision capability's only way to a vendor.
 *
 * <p>The photo travels as a data URL of the bytes this backend fetched, never as its CDN address (handing the vendor
 * the address would make them fetch it — a second egress SellerOps does not control). {@link #requestBody} is the
 * payload floor: the photo, {@link ReviewMediaVisionPrompt}, the rating and the review's own words.
 *
 * <p>Every failure is empty with a sanitized reason; vendor error bodies can quote the request, and the request is a
 * customer's picture.
 */
public class ReviewMediaVisionGenerator {

    private static final URI ENDPOINT = URI.create("https://api.openai.com/v1/chat/completions");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** What the model reported about one photo. */
    public record Observation(String depicts, ReviewMedia.ProblemVisible problemVisible, String problemDescription) {
    }

    public record Result(Optional<Observation> observation, String reason) {
    }

    private final AgentLlmTransport http;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;

    public ReviewMediaVisionGenerator(AgentLlmTransport http, String modelId, String apiKey, int maxOutputTokens,
                                      String reasoningEffort) {
        this.http = http;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
    }

    /** The model identity an inspected row records. */
    public String modelVersion() {
        return ReviewMediaVisionPrompt.PROMPT_VERSION + "+openai:" + modelId;
    }

    public Result inspect(byte[] imageBytes, String contentType, Integer rating, String reviewText) {
        if (imageBytes == null || imageBytes.length == 0) {
            return new Result(Optional.empty(), "no_bytes");
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + apiKey);
        AgentLlmTransport.Response response =
                http.post(ENDPOINT, headers, requestBody(imageBytes, contentType, rating, reviewText));
        if (response.status() == 0) {
            return new Result(Optional.empty(), "transport");
        }
        if (!response.ok()) {
            return new Result(Optional.empty(), "http:" + response.status());
        }
        try {
            JsonNode envelope = MAPPER.readTree(response.body());
            String finish = envelope.path("choices").path(0).path("finish_reason").asText(null);
            if ("length".equals(finish)) {
                return new Result(Optional.empty(), "budget_exhausted");
            }
            String text = envelope.path("choices").path(0).path("message").path("content").asText(null);
            return parse(text).map(o -> new Result(Optional.of(o), "ok"))
                    .orElse(new Result(Optional.empty(), "off_schema"));
        } catch (Exception e) {
            return new Result(Optional.empty(), "unreadable_envelope");
        }
    }

    /** The model's JSON, held to the schema: a closed verdict and two bounded sentences. */
    static Optional<Observation> parse(String text) {
        if (text == null || text.isBlank()) {
            return Optional.empty();
        }
        try {
            JsonNode node = MAPPER.readTree(text);
            String depicts = bounded(node.path("depicts").asText(null), 120);
            ReviewMedia.ProblemVisible visible;
            try {
                visible = ReviewMedia.ProblemVisible.valueOf(node.path("problemVisible").asText(""));
            } catch (IllegalArgumentException unknown) {
                return Optional.empty();
            }
            if (depicts == null || depicts.isBlank()) {
                return Optional.empty();
            }
            String description = visible == ReviewMedia.ProblemVisible.YES
                    ? bounded(node.path("problemDescription").asText(null), 160) : null;
            return Optional.of(new Observation(depicts, visible, description));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private static String bounded(String value, int max) {
        if (value == null || "null".equals(value)) {
            return null;
        }
        String flat = value.replaceAll("\\s+", " ").strip();
        return flat.length() <= max ? flat : flat.substring(0, max);
    }

    /** The whole outgoing payload. Package-private so the floor test asserts the bytes, not the intent. */
    String requestBody(byte[] imageBytes, String contentType, Integer rating, String reviewText) {
        String dataUrl = "data:" + (contentType == null || contentType.isBlank() ? "image/jpeg" : contentType)
                + ";base64," + Base64.getEncoder().encodeToString(imageBytes);
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", modelId);
        ArrayNode messages = root.putArray("messages");
        ObjectNode system = messages.addObject();
        system.put("role", "system");
        system.put("content", ReviewMediaVisionPrompt.system());
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        ArrayNode content = user.putArray("content");
        ObjectNode text = content.addObject();
        text.put("type", "text");
        text.put("text", ReviewMediaVisionPrompt.user(rating, reviewText));
        ObjectNode part = content.addObject();
        part.put("type", "image_url");
        ObjectNode image = part.putObject("image_url");
        image.put("url", dataUrl);
        image.put("detail", "high");
        root.put("max_completion_tokens", maxOutputTokens);
        if (reasoningEffort != null) {
            root.put("reasoning_effort", reasoningEffort);
        }
        ObjectNode format = root.putObject("response_format");
        format.put("type", "json_schema");
        ObjectNode schema = format.putObject("json_schema");
        schema.put("name", ReviewMediaVisionPrompt.schemaName());
        schema.put("strict", true);
        ObjectNode shape = schema.putObject("schema");
        shape.put("type", "object");
        shape.put("additionalProperties", false);
        shape.putArray("required").add("depicts").add("problemVisible").add("problemDescription");
        ObjectNode props = shape.putObject("properties");
        props.putObject("depicts").put("type", "string");
        ObjectNode visible = props.putObject("problemVisible");
        visible.put("type", "string");
        visible.putArray("enum").add("YES").add("NO").add("UNCLEAR");
        props.putObject("problemDescription").putArray("type").add("string").add("null");
        return root.toString();
    }
}
