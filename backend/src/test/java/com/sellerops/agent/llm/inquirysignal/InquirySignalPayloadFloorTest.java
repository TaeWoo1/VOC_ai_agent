package com.sellerops.agent.llm.inquirysignal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.inquirysignal.InquirySignature;
import com.sellerops.reviewissue.InquiryAskKind;
import java.net.URI;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The payload floor of the heaviest of the four LLM capabilities, asserted on the SERIALIZED BYTES.
 *
 * <p><b>Why on the bytes and not on the arguments.</b> A check on what the generator meant to send keeps
 * passing after someone adds the product name "for context" or the org id "for correlation". The only
 * assertion that survives that is one that reads the actual request string — the same technique
 * {@code AgentDraftPayloadFloorTest} uses, and for a heavier exposure: this capability sends ONE
 * CUSTOMER'S OWN inquiry text.
 *
 * <p><b>And what comes back is two labels.</b> The parser accepts only exact values from the two closed
 * vocabularies, which is what lets {@code customer_memory_entries} keep its "no customer text, ever"
 * property while gaining a semantic signature. {@code 기타} is refused explicitly, because it IS in the
 * category vocabulary and means "the analyzer found nothing" — a signature built on it would let every
 * unclassifiable inquiry pool into one bucket and be shown to a seller as a pattern.
 */
class InquirySignalPayloadFloorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** A transport that records and never sends. No test in this file can reach a network. */
    private static final AgentLlmTransport SILENT = new AgentLlmTransport() {
        @Override
        public Response post(URI endpoint, Map<String, String> headers, String body) {
            return new Response(200, "{}");
        }
    };

    private static InquirySignalGenerator generator() {
        return new InquirySignalGenerator(SILENT, AgentLlmWireFormat.Vendor.OPENAI, "gpt-test",
                "sk-not-a-real-key", 200, "low", 2000);
    }

    @Test
    @DisplayName("exactly one thing leaves: the inquiry text — no id, no org, no product, no other inquiry")
    void onlyTheInquiryTextLeaves() throws Exception {
        String body = generator().requestBody("안녕하세요. 이 제품 폭이 몇 mm인가요?");

        assertThat(body).contains("폭이 몇 mm인가요");
        // Nothing that identifies WHO or WHICH. If any of these ever appears, the floor moved.
        for (String forbidden : new String[] {
            "orgId", "org_id", "inquiryId", "workItemId", "productId", "sellerAccount",
            "channelId", "@", "010-",
        }) {
            assertThat(body).as("the floor must not carry %s", forbidden).doesNotContain(forbidden);
        }
        // The body must be valid JSON with exactly one system turn and one user turn.
        var parsed = MAPPER.readTree(body);
        assertThat(parsed.path("messages").size()).isEqualTo(2);
    }

    @Test
    @DisplayName("a long inquiry is truncated, never split into a second request")
    void aLongInquiryIsTruncatedNotSplit() throws Exception {
        String longText = "가".repeat(5000);
        InquirySignalGenerator small = new InquirySignalGenerator(SILENT,
                AgentLlmWireFormat.Vendor.OPENAI, "gpt-test", "k", 200, "low", 100);

        String body = small.requestBody(longText);

        // Counted in the USER turn only: the system turn legitimately contains 가 (the 가능여부 label),
        // and a whole-body count would be measuring the vocabulary rather than the payload.
        String userTurn = MAPPER.readTree(body).path("messages").get(1).path("content").asText();
        // Splitting would mean two egresses for one customer sentence — and the second half is not a
        // second fact, it is the same question read twice.
        assertThat(userTurn.chars().filter(c -> c == '가').count()).isEqualTo(100);
    }

    @Test
    @DisplayName("the prompt interpolates both vocabularies from the code that owns them")
    void theVocabulariesAreNotRestatedByHand() {
        String system = InquirySignalPrompt.system();

        // A prompt that lists its options by hand drifts from the enum that validates them, and the
        // first symptom is a whole corpus classified as "off-vocabulary".
        for (InquiryAskKind kind : InquiryAskKind.values()) {
            assertThat(system).contains(kind.labelKo());
        }
        assertThat(system).contains("제품정보").contains("교환");
        assertThat(system).as("기타 means 'the analyzer found nothing' and must not be offered")
                .doesNotContain("기타");
    }

    @Test
    @DisplayName("only exact, in-vocabulary labels parse; anything else is a miss")
    void offVocabularyIsAMiss() {
        assertThat(InquirySignalGenerator.parse("{\"topic\":\"제품정보\",\"ask\":\"규격\"}"))
                .map(InquirySignature::signatureKey)
                .contains("제품정보:규격");

        for (String offSchema : new String[] {
            "{\"topic\":\"기타\",\"ask\":\"규격\"}",          // the fallback category, refused explicitly
            "{\"topic\":\"배송비\",\"ask\":\"규격\"}",         // not in the category vocabulary
            "{\"topic\":\"제품정보\",\"ask\":\"궁금함\"}",     // not an ask kind
            "{\"topic\":\"\",\"ask\":\"\"}",                    // the model declining
            "제품정보:규격",                                     // not JSON
        }) {
            assertThat(InquirySignalGenerator.parse(offSchema))
                    .as("off-vocabulary must be a miss, never a nearest match: %s", offSchema)
                    .isEmpty();
        }
    }

    @Test
    @DisplayName("the version string fits the column that has to store it")
    void theVersionStringFitsItsColumn() {
        // Found live 2026-08-21 on the first real classification: the composite version is ~95 chars and
        // the column was 64, so the insert failed AFTER the model had already been asked — the one
        // ordering where a width mistake costs an egress. V50 widened it; this pins the relationship so
        // a future segment added to the version is caught here rather than in production.
        String version = generator().version();

        assertThat(version)
                .as("a version that named only the model would make a measurement unreproducible")
                .contains("inquiry-signal/v1").contains("gpt-test")
                .contains(InquirySignalPrompt.PROMPT_VERSION);
        assertThat(version.length())
                .as("inquiry_signature_cache.provider_version is varchar(256) since V50")
                .isLessThanOrEqualTo(256);
    }

    @Test
    @DisplayName("severity is a property of the ask kind, never a per-inquiry judgement")
    void severityIsFixedByVocabulary() {
        Optional<InquirySignature> defect = InquirySignalGenerator.parse("{\"topic\":\"품질\",\"ask\":\"하자\"}");
        Optional<InquirySignature> cost = InquirySignalGenerator.parse("{\"topic\":\"가격\",\"ask\":\"비용\"}");

        // A defect report is operationally heavier than a cost question regardless of how either was
        // worded — the rule IssueVocabulary states for problems, applied here for the same reason.
        assertThat(defect.orElseThrow().severity()).isNotEqualTo(cost.orElseThrow().severity());
    }
}
