package com.sellerops.product.detail.image;

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
 * One image, one call — the sixth LLM capability's only door to a vendor.
 *
 * <p><b>Why not many images per call.</b> The vendor allows up to 1,500 images in one request and it
 * would be marginally cheaper: batching saves only the constant prompt's repetition, about $0.005
 * across all 26 pictures. What it would cost is the thing that cannot be bought back — with one
 * image in the request, the model CANNOT misattribute a fact to the wrong picture, because it only
 * ever saw one. Batched, provenance becomes an {@code imageOrdinal} the model reports about itself,
 * which is an unverifiable claim sitting underneath a sentence a customer will read.
 *
 * <p><b>The payload floor is {@link #requestBody}.</b> Two things go out: the picture's bytes and
 * {@link ImageFactExtractionPrompt}, whose methods take no arguments. No product title, no option
 * list, no customer inquiry, no past answer, no policy, no seller identity, no id. Package-private so
 * the floor test can assert the serialized bytes rather than this method's intent.
 *
 * <p><b>The image travels as a data URL, not as its CDN address.</b> Handing the vendor a URL would
 * make them fetch it — a second, unbounded egress from a network SellerOps does not control, of a
 * URL that identifies the seller's shop. The bytes are already in memory from a fetch this backend
 * made under {@link ImageFetchPolicy}; they go and nothing else does.
 *
 * <p>Every failure is {@code Optional.empty()} with a coarse, sanitized reason. Vendor error bodies
 * can quote the request, and the request is the seller's own picture.
 */
public class ImageFactExtractionGenerator {

    /** Which wire format to speak. Nothing else differs between them. */
    public enum Vendor {
        ANTHROPIC(URI.create("https://api.anthropic.com/v1/messages")),
        OPENAI(URI.create("https://api.openai.com/v1/chat/completions"));

        private final URI endpoint;

        Vendor(URI endpoint) {
            this.endpoint = endpoint;
        }

        public static Vendor of(String name) {
            return "ANTHROPIC".equalsIgnoreCase(name) ? ANTHROPIC : OPENAI;
        }
    }

    /** Part of the version string, so a receipt records which extractor produced its triples. */
    public static final String EXTRACTOR_VERSION = "image-fact/v1+" + ImageFactExtractionPrompt.PROMPT_VERSION
            + "+schema/v1";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport http;
    private final Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final String version;

    public ImageFactExtractionGenerator(AgentLlmTransport http, Vendor vendor, String modelId,
                                        String apiKey, int maxOutputTokens, String reasoningEffort) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        this.version = EXTRACTOR_VERSION + "+" + vendor.name().toLowerCase() + ":" + modelId
                + "+detail:" + ImageKnowledgeProperties.DETAIL + "+out" + maxOutputTokens
                + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    /** Everything that decides what an extraction IS, in one string a receipt can store. */
    public String version() {
        return version;
    }

    /** The model identity a receipt stores separately, so a model change alone re-runs the image. */
    public String modelVersion() {
        return vendor.name().toLowerCase() + ":" + modelId;
    }

    /**
     * @param facts  the validated triples, or empty when nothing usable came back
     * @param reason a sanitized marker for the operator log; never vendor body text
     * @param usage  the vendor's own token counts, when it reported them
     */
    public record Result(Optional<ExtractedImageFacts> facts, String reason, Usage usage) {

        public static Result failed(String reason) {
            return new Result(Optional.empty(), reason, Usage.NONE);
        }

        public boolean ok() {
            return facts.isPresent();
        }
    }

    /** What the vendor said it charged for. Reported, never trusted as a cost fence. */
    public record Usage(int promptTokens, int completionTokens) {

        public static final Usage NONE = new Usage(0, 0);

        public Usage plus(Usage other) {
            return new Usage(promptTokens + other.promptTokens,
                    completionTokens + other.completionTokens);
        }
    }

    public Result generate(byte[] imageBytes, String contentType) {
        if (imageBytes == null || imageBytes.length == 0) {
            return Result.failed("no_bytes");
        }
        String body = requestBody(imageBytes, contentType);
        AgentLlmTransport.Response response = http.post(vendor.endpoint, headers(), body);
        if (response.status() == 0) {
            return Result.failed("transport:" + response.body());
        }
        if (!response.ok()) {
            return Result.failed("http:" + response.status());
        }
        JsonNode envelope;
        try {
            envelope = MAPPER.readTree(response.body());
        } catch (Exception e) {
            return Result.failed("unreadable_envelope");
        }
        Usage usage = usageOf(envelope);
        String stop = stopReason(envelope);
        if ("length".equals(stop) || "max_tokens".equals(stop)) {
            // Named rather than surfacing as an empty answer: this is the difference between "the
            // picture states nothing" and "the budget was too small to say what it states", and only
            // one of those is a finding about the seller's page.
            return new Result(Optional.empty(), "budget_exhausted", usage);
        }
        Optional<String> text = ImageFactResponseParser.assistantText(response.body());
        if (text.isEmpty()) {
            return new Result(Optional.empty(), "no_message_text", usage);
        }
        Optional<ExtractedImageFacts> parsed = ImageFactResponseParser.parse(text.get());
        if (parsed.isEmpty()) {
            return new Result(Optional.empty(), "off_schema", usage);
        }
        return new Result(parsed, "ok", usage);
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
     * The whole outgoing payload: one picture and one constant instruction.
     *
     * <p>Parameter names are the ones the vendor's Chat Completions reference states — the image part
     * is {@code {"type":"image_url","image_url":{"url":…,"detail":…}}} (the flat {@code input_image}
     * form belongs to the Responses API, which this product does not speak), the output cap is
     * {@code max_completion_tokens}, and the effort is {@code reasoning_effort}. This transport seam
     * is reused exactly as it is; no endpoint migration rides in on this package.
     */
    String requestBody(byte[] imageBytes, String contentType) {
        String dataUrl = "data:" + (contentType == null || contentType.isBlank() ? "image/jpeg" : contentType)
                + ";base64," + Base64.getEncoder().encodeToString(imageBytes);
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", modelId);
        ArrayNode messages = root.putArray("messages");
        if (vendor == Vendor.ANTHROPIC) {
            root.put("max_tokens", maxOutputTokens);
            root.put("system", ImageFactExtractionPrompt.system());
            ObjectNode user = messages.addObject();
            user.put("role", "user");
            ObjectNode part = user.putArray("content").addObject();
            part.put("type", "image");
            ObjectNode src = part.putObject("source");
            src.put("type", "base64");
            src.put("media_type", contentType);
            src.put("data", Base64.getEncoder().encodeToString(imageBytes));
        } else {
            ObjectNode system = messages.addObject();
            system.put("role", "system");
            system.put("content", ImageFactExtractionPrompt.system());
            ObjectNode user = messages.addObject();
            user.put("role", "user");
            ObjectNode part = user.putArray("content").addObject();
            part.put("type", "image_url");
            ObjectNode image = part.putObject("image_url");
            image.put("url", dataUrl);
            image.put("detail", ImageKnowledgeProperties.DETAIL);
            root.put("max_completion_tokens", maxOutputTokens);
            root.set("response_format", responseFormat());
            if (reasoningEffort != null) {
                root.put("reasoning_effort", reasoningEffort);
            }
        }
        return root.toString();
    }

    /** {@code json_schema} + {@code strict}: a closed object, all fields required, no extras. */
    private ObjectNode responseFormat() {
        ObjectNode format = MAPPER.createObjectNode();
        format.put("type", "json_schema");
        ObjectNode schema = format.putObject("json_schema");
        schema.put("name", ImageFactExtractionPrompt.schemaName());
        schema.put("strict", true);
        ObjectNode root = schema.putObject("schema");
        root.put("type", "object");
        root.put("additionalProperties", false);
        root.putArray("required").add("facts");
        ObjectNode facts = root.putObject("properties").putObject("facts");
        facts.put("type", "array");
        ObjectNode item = facts.putObject("items");
        item.put("type", "object");
        item.put("additionalProperties", false);
        ArrayNode required = item.putArray("required");
        ObjectNode properties = item.putObject("properties");
        for (String field : new String[] {"specLabel", "attribute", "value"}) {
            required.add(field);
            properties.putObject(field).put("type", "string");
        }
        return format;
    }

    private Usage usageOf(JsonNode envelope) {
        JsonNode usage = envelope.path("usage");
        if (usage.isMissingNode()) {
            return Usage.NONE;
        }
        int prompt = usage.path("prompt_tokens").asInt(usage.path("input_tokens").asInt(0));
        int completion = usage.path("completion_tokens").asInt(usage.path("output_tokens").asInt(0));
        return new Usage(prompt, completion);
    }

    private String stopReason(JsonNode envelope) {
        return vendor == Vendor.ANTHROPIC
                ? envelope.path("stop_reason").asText(null)
                : envelope.path("choices").path(0).path("finish_reason").asText(null);
    }
}
