package com.sellerops.review.triage.llm;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.review.triage.llm.ReviewTriageClassifier.Input;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * RUBRIC v2 §8.4, enforced on the bytes.
 *
 * <p>The rule this guards is §8.3's payload floor: <b>the star rating and the review body, and
 * nothing else</b> — "whether or not a model would classify better with it". The failure it exists
 * to catch is not malice, it is a future change that adds the product name to the prompt because
 * accuracy improved, in a codebase where nothing said no.
 *
 * <p>It asserts the <b>serialized request</b> rather than the builder's inputs, the same way
 * {@code build-annotator-package.mjs} re-reads the file it just wrote. A check on the intent would
 * keep passing after the intent changed.
 */
class TriagePayloadFloorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static ApiTriageClassifier classifier(ApiTriageClassifier.Vendor vendor) {
        return new ApiTriageClassifier((uri, headers, body) -> new LlmHttpClient.Response(200, "{}"),
                vendor, "test-model", "test-key");
    }

    /** Every string value anywhere in the request, so nothing hides inside a nested object. */
    private static List<String> strings(JsonNode node, List<String> into) {
        if (node.isObject()) {
            node.fields().forEachRemaining(e -> strings(e.getValue(), into));
        } else if (node.isArray()) {
            node.forEach(child -> strings(child, into));
        } else if (node.isTextual()) {
            into.add(node.asText());
        }
        return into;
    }

    @ParameterizedTest
    @EnumSource(ApiTriageClassifier.Vendor.class)
    @DisplayName("the request carries the rating and the body, and no identifying material")
    void theRequestCarriesNothingIdentifying(ApiTriageClassifier.Vendor vendor) throws Exception {
        // Values a real caller has in hand at the moment it classifies, and must not pass on.
        String body = "포장이 찌그러져서 왔어요";
        String payload = classifier(vendor).requestBody(new Input(2, body));

        assertThat(payload).as("the body is what we are here to send").contains(body);
        assertThat(payload).as("the rating is the other permitted field").contains("2점");

        for (String forbidden : List.of(
                "1234567890",                                                       // 리뷰글번호
                "a".repeat(64),                                                     // fingerprint
                "홍길동",                                                            // author
                "무선 이어폰",                                                        // product
                "SKU-1", "2026-08-17", "NAVER", "demo@sellerops.ai",                // sku, date, channel, seller
                "NEEDS_LOOK")) {                                                    // a gold label
            assertThat(payload).as("a request must not carry %s", forbidden).doesNotContain(forbidden);
        }
    }

    @ParameterizedTest
    @EnumSource(ApiTriageClassifier.Vendor.class)
    @DisplayName("the only free text in the request is the review body itself")
    void theOnlyFreeTextIsTheBody(ApiTriageClassifier.Vendor vendor) throws Exception {
        String body = "설치가 안 됩니다";
        JsonNode root = MAPPER.readTree(classifier(vendor).requestBody(new Input(1, body)));

        // The stronger form of the check above: rather than listing what must be absent, list what
        // may be present. Anything else in the request is a leak by construction.
        List<String> unexpected = new ArrayList<>();
        for (String value : strings(root, new ArrayList<>())) {
            boolean allowed = value.equals("test-model")
                    || value.equals("user") || value.equals("system") || value.equals("json_object")
                    || value.equals(TriagePrompt.SYSTEM)
                    || value.equals(TriagePrompt.userTurn(1, body));
            if (!allowed) {
                unexpected.add(value);
            }
        }
        assertThat(unexpected).as("strings in the request that the contract does not admit").isEmpty();
    }

    @Test
    @DisplayName("the user turn is the rating and the body — the whole floor, at the last moment")
    void theUserTurnIsTheFloor() {
        String turn = TriagePrompt.userTurn(3, "괜찮아요");
        assertThat(turn).isEqualTo("별점: 3점\n본문:\n괜찮아요");
        assertThat(TriagePrompt.userTurn(null, null)).isEqualTo("별점: 없음\n본문:\n");
    }

    @Test
    @DisplayName("the system prompt carries no review from the corpus as a worked example")
    void thePromptTeachesAbstractly() {
        // A prompt carrying evaluation rows would be scored against reviews it had been shown, and
        // §6.3's rule about terms traceable to a specific unlabeled review applies harder to whole
        // reviews. v1 §2's tie-breakers are abstract cases and that is what the prompt teaches.
        assertThat(TriagePrompt.SYSTEM).doesNotContain("합성", "리뷰글번호", "예시:", "다음 리뷰");
        assertThat(TriagePrompt.SYSTEM).contains("NEEDS_ATTENTION", "WATCH", "FYI");
    }

    @Test
    @DisplayName("the api key never leaves through a Result")
    void theKeyStaysOutOfEveryResult() {
        ApiTriageClassifier failing = new ApiTriageClassifier(
                (uri, headers, body) -> new LlmHttpClient.Response(401, "{\"error\":\"bad key sk-secret\"}"),
                ApiTriageClassifier.Vendor.ANTHROPIC, "test-model", "sk-secret");
        ReviewTriageClassifier.Result result = failing.classify(new Input(1, "본문"));

        assertThat(result.status()).isEqualTo(ReviewTriageClassifier.Status.CLASSIFICATION_FAILED);
        // The vendor's error body can quote the request, and the request contains the review — so
        // the failure reason is the status and nothing else.
        assertThat(result.failureReason()).isEqualTo("http 401");
        assertThat(result.failureReason()).doesNotContain("sk-secret");
    }
}
