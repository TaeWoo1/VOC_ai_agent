package com.sellerops.product.detail.image;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The payload floor for the sixth LLM capability, asserted on the BYTES that leave.
 *
 * <p>This one matters more than its five predecessors. Every other capability sends text SellerOps
 * chose — an inquiry body, a review, an operator's sentence — so its floor is a question of what was
 * added. Here the payload is the seller's own picture, and <b>nobody has read it before it goes.</b>
 * What can still be guaranteed is that nothing ELSE goes with it, and that is what this checks: the
 * request has five keys, the instruction is a constant, and the user turn contains one image and
 * nothing beside it.
 */
class ImageFactPayloadFloorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Records the body and answers nothing. The floor is about what leaves, not what returns. */
    private static final class Recording implements AgentLlmTransport {
        String body;

        @Override
        public Response post(URI uri, Map<String, String> headers, String jsonBody) {
            this.body = jsonBody;
            return new Response(500, "{}");
        }
    }

    private static ImageFactExtractionGenerator generator() {
        return new ImageFactExtractionGenerator(new Recording(),
                ImageFactExtractionGenerator.Vendor.OPENAI, "gpt-5.6-terra", "key", 1200, "none");
    }

    private static byte[] picture() {
        return new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x01, 0x02, 0x03};
    }

    @Test
    @DisplayName("one image and one constant instruction — the request has nothing else in it")
    void thePayloadIsOneImageAndAConstant() throws Exception {
        JsonNode root = MAPPER.readTree(generator().requestBody(picture(), "image/jpeg"));

        List<String> keys = new ArrayList<>();
        root.fieldNames().forEachRemaining(keys::add);
        assertThat(keys).containsExactlyInAnyOrder("model", "messages", "max_completion_tokens",
                "response_format", "reasoning_effort");

        JsonNode messages = root.get("messages");
        assertThat(messages).hasSize(2);
        assertThat(messages.get(0).get("role").asText()).isEqualTo("system");
        assertThat(messages.get(0).get("content").asText())
                .as("the instruction is a constant with no argument to smuggle anything through")
                .isEqualTo(ImageFactExtractionPrompt.system());

        JsonNode content = messages.get(1).get("content");
        assertThat(messages.get(1).get("role").asText()).isEqualTo("user");
        assertThat(content).as("one part: the picture. Not a caption, not a hint, not a question")
                .hasSize(1);
        assertThat(content.get(0).get("type").asText()).isEqualTo("image_url");
        List<String> partKeys = new ArrayList<>();
        content.get(0).fieldNames().forEachRemaining(partKeys::add);
        assertThat(partKeys).containsExactlyInAnyOrder("type", "image_url");
    }

    @Test
    @DisplayName("nothing about this seller, product, customer or listing is on the wire")
    void nothingIdentifyingTravels() {
        String body = generator().requestBody(picture(), "image/jpeg");
        // The whole payload minus the base64 blob: what is left must contain no identifier at all.
        String withoutImage = body.replaceAll("data:[^\"]+", "");

        assertThat(withoutImage).doesNotContain("13250364547");
        assertThat(withoutImage).doesNotContain("전선몰딩");
        for (String forbidden : List.of("productId", "product_id", "inquiry", "orgId", "org_id",
                "sellerAccount", "listing", "option", "customer", "past", "policy")) {
            assertThat(withoutImage.toLowerCase(java.util.Locale.ROOT))
                    .as(forbidden + " must not appear anywhere in the request")
                    .doesNotContain(forbidden.toLowerCase(java.util.Locale.ROOT));
        }
    }

    @Test
    @DisplayName("the picture travels as bytes, never as the shop's CDN address")
    void theImageIsSentAsBytes() throws Exception {
        JsonNode root = MAPPER.readTree(generator().requestBody(picture(), "image/png"));
        String url = root.get("messages").get(1).get("content").get(0).get("image_url").get("url")
                .asText();

        // A URL would make the vendor fetch it: a second, unbounded egress from a network we do not
        // control, of an address that identifies the seller's shop.
        assertThat(url).startsWith("data:image/png;base64,");
        assertThat(url).doesNotContain("http");
    }

    @Test
    @DisplayName("the cost fence is in the request: detail=high, a small output cap, no reasoning")
    void theCostFenceIsOnTheWire() throws Exception {
        JsonNode root = MAPPER.readTree(generator().requestBody(picture(), "image/jpeg"));

        // detail=auto behaves like `original` on this model — no patch-budget limit — which would make
        // the per-image ceiling unknowable. `high` caps it at 2,500 patches, so the manifest can state
        // a number instead of a hope.
        assertThat(root.get("messages").get(1).get("content").get(0).get("image_url").get("detail")
                .asText()).isEqualTo("high");
        assertThat(root.get("max_completion_tokens").asInt()).isEqualTo(1200);
        assertThat(root.get("reasoning_effort").asText()).isEqualTo("none");
    }

    @Test
    @DisplayName("the answer shape is requested strictly, and the schema is closed")
    void theSchemaIsStrictAndClosed() throws Exception {
        JsonNode format = MAPPER.readTree(generator().requestBody(picture(), "image/jpeg"))
                .get("response_format");

        assertThat(format.get("type").asText()).isEqualTo("json_schema");
        JsonNode schema = format.get("json_schema");
        assertThat(schema.get("strict").asBoolean()).isTrue();
        assertThat(schema.get("schema").get("additionalProperties").asBoolean()).isFalse();
        JsonNode item = schema.get("schema").get("properties").get("facts").get("items");
        assertThat(item.get("additionalProperties").asBoolean())
                .as("an open item schema is where a free-form OCR dump would arrive")
                .isFalse();
        List<String> required = new ArrayList<>();
        item.get("required").forEach(node -> required.add(node.asText()));
        assertThat(required).containsExactlyInAnyOrder("specLabel", "attribute", "value");
    }
}
