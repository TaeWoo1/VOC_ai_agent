package com.sellerops.product.detail.image;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Read the vendor's answer, and refuse everything that is not the closed shape.
 *
 * <p><b>Strict schema is a request, not a guarantee.</b> The vendor is asked for
 * {@code json_schema}+{@code strict}, and this validates the result anyway — the same discipline the
 * draft capability's parser carries. A schema flag is a property of a request; what arrives is a
 * property of a response.
 *
 * <p><b>A malformed answer is a refusal, never a repair.</b> There is no second call, no coaxing
 * pass and no partial acceptance of a well-formed prefix: this lane's output ends up as a sentence a
 * seller sends to their customer, and a triple salvaged from a broken answer is exactly the kind of
 * thing that reads fine and is wrong.
 */
public final class ImageFactResponseParser {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ImageFactResponseParser() {
    }

    /** The assistant's text, from whichever envelope the vendor uses. */
    public static Optional<String> assistantText(String body) {
        try {
            JsonNode root = MAPPER.readTree(body);
            JsonNode openAi = root.path("choices").path(0).path("message").path("content");
            if (openAi.isTextual() && !openAi.asText().isBlank()) {
                return Optional.of(openAi.asText());
            }
            JsonNode anthropic = root.path("content");
            if (anthropic.isArray()) {
                for (JsonNode part : anthropic) {
                    if (part.path("text").isTextual() && !part.path("text").asText().isBlank()) {
                        return Optional.of(part.path("text").asText());
                    }
                }
            }
            return Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /**
     * Validate one answer into {@link ExtractedImageFacts}, or refuse it.
     *
     * <p>Empty {@code facts} parses successfully — "this picture states no specification" is the
     * expected answer for most of a 상세페이지 and must not look like a broken call.
     */
    public static Optional<ExtractedImageFacts> parse(String text) {
        if (text == null || text.isBlank()) {
            return Optional.empty();
        }
        JsonNode root;
        try {
            root = MAPPER.readTree(text);
        } catch (Exception e) {
            return Optional.empty();
        }
        if (!root.isObject() || !root.has("facts")) {
            return Optional.empty();
        }
        JsonNode facts = root.get("facts");
        if (!facts.isArray() || facts.size() > ExtractedImageFacts.MAX_FACTS) {
            return Optional.empty();
        }
        List<ExtractedImageFacts.Fact> out = new ArrayList<>(facts.size());
        for (JsonNode node : facts) {
            if (!node.isObject()) {
                return Optional.empty();
            }
            String specLabel = field(node, "specLabel");
            String attribute = field(node, "attribute");
            String value = field(node, "value");
            if (attribute == null || value == null) {
                // specLabel MAY be absent — the model was told to omit an unlabelled value, and one
                // that arrives unlabelled anyway is kept so the authority rules can REFUSE it by
                // name (rule A) rather than have it disappear before anybody counted it.
                return Optional.empty();
            }
            out.add(new ExtractedImageFacts.Fact(specLabel, attribute, value));
        }
        return Optional.of(new ExtractedImageFacts(out));
    }

    /** A present, non-blank, in-bounds string — or null. Anything else fails its caller's check. */
    private static String field(JsonNode node, String name) {
        JsonNode value = node.get(name);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            return null;
        }
        String text = value.asText().strip();
        if (text.isEmpty() || text.length() > ExtractedImageFacts.MAX_FIELD_CHARS) {
            return null;
        }
        return text;
    }
}
