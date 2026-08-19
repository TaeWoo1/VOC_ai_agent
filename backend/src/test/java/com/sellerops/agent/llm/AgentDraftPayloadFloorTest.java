package com.sellerops.agent.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * <b>The payload floor, asserted on the serialized bytes.</b>
 *
 * <p>This is the test the whole capability rests on. {@code DraftModelSeam}'s docblock said inquiry
 * title/body "is PII and must not egress until that decision"; the decision was made, and what makes
 * it a bounded one rather than an open door is that exactly two of the seller's values may leave and
 * a machine checks which. A test that read {@code requestBody}'s intent would keep passing the day
 * someone adds the work-item id "for correlation" — so every assertion below is against the string
 * that goes on the wire, built from an {@link AgentDraftGenerator.Input} whose two fields are the
 * only content it is given.
 */
class AgentDraftPayloadFloorTest {

    /**
     * Values that MUST NOT appear. Each is something a caller plausibly has in hand at the moment it
     * builds this request, which is exactly why the list is explicit rather than "no PII".
     */
    private static final List<String> FORBIDDEN = List.of(
            "7f3a1c9e-0000-4000-8000-000000000001", // orgId
            "9b2d4f60-0000-4000-8000-000000000002", // workItemId
            "c4e8a712-0000-4000-8000-000000000003", // inquiryId
            "김구매",                                  // buyer name
            "010-1234-5678",                         // buyer phone
            "buyer@example.com",                     // buyer email
            "서울시 강남구",                            // shipping address
            "20260819-0001",                         // order number
            "PROPOSED",                              // work-item phase
            "CAFE24",                                // channel code
            "2026-08-19T00:00:00Z");                 // received-at timestamp

    private static AgentDraftGenerator generator(AgentDraftGenerator.Vendor vendor) {
        return new AgentDraftGenerator(
                (uri, headers, body) -> new AgentLlmTransport.Response(200, "{}"),
                vendor, "test-model", "sk-should-never-appear", 4000, "low");
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("the outgoing body carries the inquiry's title and body — and nothing else of the seller's")
    void theBodyCarriesOnlyTitleAndDetails(AgentDraftGenerator.Vendor vendor) {
        String body = generator(vendor).requestBody(
                new AgentDraftGenerator.Input("배송 언제 오나요", "어제 주문했는데 아직 발송 전이라고 나옵니다."));

        assertThat(body).as("the two fields that MAY leave are there")
                .contains("배송 언제 오나요")
                .contains("어제 주문했는데 아직 발송 전이라고 나옵니다.");
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("the API key never rides in the body — it is a header, on both wire formats")
    void theKeyIsNeverInTheBody(AgentDraftGenerator.Vendor vendor) {
        assertThat(generator(vendor).requestBody(new AgentDraftGenerator.Input("t", "d")))
                .doesNotContain("sk-should-never-appear");
    }

    @Test
    @DisplayName("a null body becomes an empty line, never the string \"null\"")
    void nullDetailsDoNotBecomeTheWordNull() {
        String body = generator(AgentDraftGenerator.Vendor.OPENAI)
                .requestBody(new AgentDraftGenerator.Input("제목만 있는 문의", null));
        // The model would otherwise be answering a question about a literal four-letter word.
        assertThat(body).contains("본문:").doesNotContain("본문:\\nnull");
    }

    @Test
    @DisplayName("the structured-output contract is on the request, not only in the prompt")
    void openAiAsksForJson() {
        assertThat(generator(AgentDraftGenerator.Vendor.OPENAI).requestBody(new AgentDraftGenerator.Input("t", "d")))
                .contains("\"response_format\"")
                .contains("\"json_object\"");
    }

    @Test
    @DisplayName("the version string names everything that decides what a draft is")
    void theVersionIsSelfDescribing() {
        String version = generator(AgentDraftGenerator.Vendor.OPENAI).version();
        assertThat(version)
                .contains("agent-draft/v1")
                .contains("openai:test-model")
                .contains(AgentDraftPrompt.PROMPT_VERSION)
                .contains("out4000")
                .contains("effort:low");
        assertThat(version).as("and never the key").doesNotContain("sk-should-never-appear");
    }
}
