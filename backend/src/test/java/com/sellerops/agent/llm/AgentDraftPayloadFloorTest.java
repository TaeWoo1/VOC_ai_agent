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
 * it a bounded one rather than an open door is that exactly three of the seller's values may leave
 * and a machine checks which. A test that read {@code requestBody}'s intent would keep passing the day
 * someone adds the work-item id "for correlation" — so every assertion below is against the string
 * that goes on the wire, built from an {@link AgentDraftGenerator.Input} whose fields are the only
 * content it is given.
 *
 * <p><b>The floor moved once, deliberately, and this is where that is recorded.</b> Inquiry Draft v1
 * grounds a reply in the seller's own 상품 지식, which cannot be done without sending it. So the floor
 * is now title + body + retrieved passage text — and the passages arrive stripped of everything that
 * identifies them: no product id, no source id, no chunk id, no author, no timestamp, no retrieval
 * score. The citation the seller reads is reassembled on the way back from the retrieval result,
 * whose ids never left the backend.
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
            "2026-08-19T00:00:00Z",                  // received-at timestamp
            "a1b2c3d4-0000-4000-8000-000000000004",  // knowledge source id
            "e5f6a7b8-0000-4000-8000-000000000005",  // knowledge chunk id
            "0.8734");                               // retrieval score

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
    @DisplayName("retrieved product knowledge leaves as heading + text, carrying no identifier of its own")
    void knowledgeLeavesWithoutItsIdentifiers(AgentDraftGenerator.Vendor vendor) {
        String body = generator(vendor).requestBody(new AgentDraftGenerator.Input(
                "사용 방법이 궁금해요", "처음 써봅니다.",
                List.of(new AgentDraftGenerator.Passage("사용법",
                        "몰딩 뒷면 테이프를 벗기고 벽면에 눌러 붙입니다."))));

        assertThat(body).as("the seller's own knowledge is what grounds the draft")
                .contains("사용법")
                .contains("몰딩 뒷면 테이프를 벗기고 벽면에 눌러 붙입니다.");
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("an empty library is stated to the model, not omitted — silence would read as \"not relevant\"")
    void anEmptyLibraryIsStatedRatherThanOmitted(AgentDraftGenerator.Vendor vendor) {
        assertThat(generator(vendor).requestBody(new AgentDraftGenerator.Input("질문", "본문")))
                .contains("판매자가 등록한 근거")
                .contains("(없음)");
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("the API key never rides in the body — it is a header, on both wire formats")
    void theKeyIsNeverInTheBody(AgentDraftGenerator.Vendor vendor) {
        assertThat(generator(vendor).requestBody(new AgentDraftGenerator.Input("t", "d")))
                .doesNotContain("sk-should-never-appear");
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("the spec-applicability line states a fact about the question, never an option name")
    void theSpecScopeLineCarriesNoCatalogue(AgentDraftGenerator.Vendor vendor) {
        // Added with Answer Applicability v1. The line exists so a retrieved figure is not asserted
        // as settled — which is a property of the question, so the seller's option table has no
        // reason to leave and does not.
        String body = generator(vendor).requestBody(new AgentDraftGenerator.Input(
                "질문", "본문", List.of(), null,
                com.sellerops.inquiry.draft.SpecApplicability.Applicability.VARIANT_UNRESOLVED.messageKo()));

        assertThat(body).contains("규격 적용 범위").contains("확정되지 않았습니다");
        assertThat(body).as("no option name, no variant id, no sku")
                .doesNotContain("중형 25mm")
                .doesNotContain("f9c0b3a1-0000-4000-8000-000000000006");
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

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("the order state leaves as a sentence — never the order identifier")
    void theOrderStateLeavesWithoutItsIdentifier(AgentDraftGenerator.Vendor vendor) {
        String body = generator(vendor).requestBody(new AgentDraftGenerator.Input(
                "주문 취소됐나요", "어제 취소 요청했습니다.", List.of(),
                "이 주문은 결제가 완료된 것으로 확인됩니다. 발송 여부는 확인되지 않았습니다."));

        assertThat(body).as("what the model may reason from is the STATE")
                .contains("주문 상태")
                .contains("결제가 완료된 것으로 확인됩니다");
        for (String forbidden : FORBIDDEN) {
            // "20260819-0001" is in that list precisely because this is the request that now has an
            // order in scope. The reference stays on the inquiry row, where the join needs it.
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("the answer style leaves as instructions and quoted phrases — never as an identifier")
    void theStyleSectionCarriesOnlyWording(AgentDraftGenerator.Vendor vendor) {
        // Organization Answer Style v1 moved the floor a second time, and by one class of content:
        // this org's own wording settings. They name no customer, no order, no product and no id.
        String style = com.sellerops.knowledge.style.AnswerStyleInstruction.of(
                new com.sellerops.knowledge.style.AnswerStyleProfile(
                        com.sellerops.knowledge.style.AnswerTone.FRIENDLY,
                        com.sellerops.knowledge.style.AnswerLength.SHORT,
                        com.sellerops.knowledge.style.EmojiPolicy.NONE,
                        "안녕하세요. 선바로입니다.", "감사합니다.", "고객님",
                        List.of("잘 부탁드립니다"), List.of("죄송하지만"), null, 2));
        String body = generator(vendor).requestBody(new AgentDraftGenerator.Input(
                "질문", "본문", List.of(), null, null, style));

        assertThat(body).contains("답변 스타일").contains("고객님").contains("잘 부탁드립니다");
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("C — two styles over the same question send the SAME facts and differ only in wording")
    void aStyleChangeMovesNoFact(AgentDraftGenerator.Vendor vendor) {
        List<AgentDraftGenerator.Passage> knowledge = List.of(
                new AgentDraftGenerator.Passage("상품 정보", "부착 방법",
                        "몰딩 뒷면 테이프를 벗기고 벽면에 눌러 붙입니다."));
        String order = "이 주문은 결제가 완료된 것으로 확인됩니다.";
        String spec = com.sellerops.inquiry.draft.SpecApplicability.Applicability
                .VARIANT_UNRESOLVED.messageKo();
        String style = com.sellerops.knowledge.style.AnswerStyleInstruction.of(
                new com.sellerops.knowledge.style.AnswerStyleProfile(
                        com.sellerops.knowledge.style.AnswerTone.CONCISE,
                        com.sellerops.knowledge.style.AnswerLength.DETAILED,
                        com.sellerops.knowledge.style.EmojiPolicy.LIMITED,
                        null, null, "고객님", List.of(), List.of(), null, 4));

        // The factual half of the user turn is IDENTICAL, and the style is strictly appended to it.
        // A style that could move a figure, a passage or an order state would not be a style; it
        // would be a second source of facts with no evidence behind it.
        String plainTurn = AgentDraftPrompt.user("질문", "본문", knowledge, order, spec, null);
        String styledTurn = AgentDraftPrompt.user("질문", "본문", knowledge, order, spec, style);
        assertThat(styledTurn).startsWith(plainTurn);
        assertThat(plainTurn).doesNotContain("답변 스타일");

        // And on the wire: the system turn is a constant, so two styles differ only by that suffix.
        String plain = generator(vendor).requestBody(
                new AgentDraftGenerator.Input("질문", "본문", knowledge, order, spec, null));
        String styled = generator(vendor).requestBody(
                new AgentDraftGenerator.Input("질문", "본문", knowledge, order, spec, style));
        for (String fact : List.of("몰딩 뒷면 테이프", "결제가 완료된 것으로 확인됩니다", "확정되지 않았습니다")) {
            assertThat(plain).contains(fact);
            assertThat(styled).contains(fact);
        }
        assertThat(styled).contains("고객님");
        assertThat(plain).doesNotContain("고객님");
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("a caller that never looked and a lookup that found nothing say the same thing")
    void anAbsentOrderStateIsStatedRatherThanOmitted(AgentDraftGenerator.Vendor vendor) {
        assertThat(generator(vendor).requestBody(new AgentDraftGenerator.Input("질문", "본문")))
                .contains("주문 상태")
                .contains("(확인된 값 없음)");
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("Seller Context v1-B — the company description leaves as quoted context on the USER turn, with no identifier, and never touches the facts")
    void theCompanySectionIsContextNotEvidence(AgentDraftGenerator.Vendor vendor) {
        List<AgentDraftGenerator.Passage> knowledge = List.of(
                new AgentDraftGenerator.Passage("상품 정보", "부착 방법", "몰딩 뒷면 테이프를 벗기고 벽면에 눌러 붙입니다."));
        String order = "이 주문은 결제가 완료된 것으로 확인됩니다.";
        String company = "전선몰딩과 전기자재를 제조·판매하며, 기업 고객과 시공업체 주문 비중이 높습니다.";

        // The factual half is IDENTICAL, and the company section is strictly appended to it — like the
        // style, and before the style: two drafts with and without a profile read the same facts.
        String plainTurn = AgentDraftPrompt.user("질문", "본문", knowledge, order, null, null, null);
        String withCompany = AgentDraftPrompt.user("질문", "본문", knowledge, order, null, null, company);
        assertThat(withCompany).startsWith(plainTurn);
        assertThat(plainTurn).doesNotContain(AgentDraftPrompt.COMPANY_SECTION_TITLE);
        assertThat(withCompany).contains(AgentDraftPrompt.COMPANY_SECTION_TITLE + ":")
                .contains(company)
                .contains(AgentDraftPrompt.COMPANY_FOOTER);
        // Section order: facts, then company context, then style — the style footer is the last word.
        String style = com.sellerops.knowledge.style.AnswerStyleInstruction.of(
                new com.sellerops.knowledge.style.AnswerStyleProfile(
                        com.sellerops.knowledge.style.AnswerTone.FRIENDLY,
                        com.sellerops.knowledge.style.AnswerLength.SHORT,
                        com.sellerops.knowledge.style.EmojiPolicy.NONE,
                        null, null, "고객님", List.of(), List.of(), null, 2));
        String both = AgentDraftPrompt.user("질문", "본문", knowledge, order, null, style, company);
        assertThat(both.indexOf(AgentDraftPrompt.COMPANY_SECTION_TITLE + ":"))
                .isLessThan(both.indexOf("답변 스타일:"));

        // On the wire: the system turn is a constant that never carries the seller's text.
        String body = generator(vendor).requestBody(new AgentDraftGenerator.Input(
                "질문", "본문", knowledge, order, null, null, company));
        assertThat(body).contains(company);
        assertThat(AgentDraftPrompt.system()).doesNotContain(company);
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
        // And a blank profile renders NOTHING — absence means "nothing to say", not "(없음)".
        assertThat(generator(vendor).requestBody(new AgentDraftGenerator.Input(
                "질문", "본문", knowledge, order, null, null, "  ")))
                .doesNotContain(AgentDraftPrompt.COMPANY_SECTION_TITLE + ":")
                .doesNotContain(AgentDraftPrompt.COMPANY_FOOTER);
    }
}
