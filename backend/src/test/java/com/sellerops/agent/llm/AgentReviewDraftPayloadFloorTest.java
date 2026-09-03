package com.sellerops.agent.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * <b>The REVIEW lane's payload floor, asserted on the serialized bytes</b> (Grounded Review Drafting
 * v1) — and it is deliberately NARROWER than the inquiry lane's.
 *
 * <p>Two classes of the seller's content may leave: the review body as the customer wrote it (already
 * redacted before it reaches the generator) and the seller-authored passages retrieved for it, plus
 * this org's own wording preferences when it set any. Nothing else — and the four sections the
 * inquiry lane renders and this one does not are each a decision recorded below, not an oversight.
 *
 * <p>The two lanes have two records and two builders precisely so that a field added to the inquiry
 * request cannot start leaving on review requests. This test is what makes that structural claim
 * checkable.
 */
class AgentReviewDraftPayloadFloorTest {

    private static final List<String> FORBIDDEN = List.of(
            "7f3a1c9e-0000-4000-8000-000000000001", // orgId
            "d1e2f3a4-0000-4000-8000-000000000006", // reviewId
            "a1b2c3d4-0000-4000-8000-000000000004", // knowledge source id
            "e5f6a7b8-0000-4000-8000-000000000005", // knowledge chunk id
            "김구매",                                  // buyer name
            "010-1234-5678",                         // buyer phone
            "20260819-0001",                         // order number
            "NAVER",                                 // channel code
            "2026-08-28",                            // review date
            "선바로 일체형 전선몰딩",                     // product name
            "0.8734");                               // retrieval score

    private static AgentDraftGenerator generator(AgentDraftGenerator.Vendor vendor) {
        return new AgentDraftGenerator(
                (uri, headers, body) -> new AgentLlmTransport.Response(200, "{}"),
                vendor, "test-model", "sk-should-never-appear", 4000, "low");
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("the outgoing body carries the review text and the retrieved passages — nothing else")
    void theBodyCarriesTheReviewAndItsGrounds(AgentDraftGenerator.Vendor vendor) {
        String body = generator(vendor).reviewRequestBody(new AgentDraftGenerator.ReviewInput(
                "괜찮긴한데 잘떨어지네요 실리콘으로 붙였네요",
                List.of(new AgentDraftGenerator.Passage("상품 정보", "부착 방법",
                        "표면의 먼지와 기름기를 닦아낸 뒤 눌러 붙여 주세요.")),
                null));

        assertThat(body).contains("괜찮긴한데 잘떨어지네요");
        assertThat(body).contains("표면의 먼지와 기름기를 닦아낸 뒤");
        assertThat(body).contains("[상품 정보]");
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("no order line, no 규격 line, no company section — a review has none of those questions")
    void theInquiryOnlySectionsAreAbsent(AgentDraftGenerator.Vendor vendor) {
        String body = generator(vendor).reviewRequestBody(
                new AgentDraftGenerator.ReviewInput("포장이 아쉬웠어요", List.of(), null));

        // Each absence is a decision: an order section invites reasoning about an order that does not
        // exist, a 규격 section answers a question nobody asked, and a company section is not what a
        // public reply is for.
        assertThat(body).doesNotContain("주문 상태");
        assertThat(body).doesNotContain("규격 적용 범위");
        assertThat(body).doesNotContain("회사 정보");
        // The rating never leaves: it decides which template is the floor, and telling the model
        // invites 「별점 4점 주셔서 감사합니다」 — a sentence about the customer's private choice.
        // Asserted on the USER turn, because the system turn names 별점 in order to forbid it.
        assertThat(AgentDraftPrompt.reviewUser(List.of(), "포장이 아쉬웠어요", null))
                .doesNotContain("별점");
    }

    @ParameterizedTest
    @EnumSource(AgentDraftGenerator.Vendor.class)
    @DisplayName("with no grounds the section says so out loud rather than being omitted")
    void anEmptyGroundsSectionIsStated(AgentDraftGenerator.Vendor vendor) {
        String body = generator(vendor).reviewRequestBody(
                new AgentDraftGenerator.ReviewInput("포장이 아쉬웠어요", List.of(), null));
        assertThat(body).contains("판매자가 등록한 근거");
        assertThat(body).contains("(없음)");
    }

    @Test
    @DisplayName("the review system turn names the seven promises and asks for one field")
    void theSystemTurnStatesTheRules() {
        String system = AgentDraftPrompt.reviewSystem();
        for (String rule : List.of("공개", "원인", "배송 일정", "교환·반품·환불", "보상", "재발송", "내부 조치")) {
            assertThat(system).as("the review prompt must name %s", rule).contains(rule);
        }
        // One field, because a public reply has no subject line and no category to choose.
        assertThat(system).contains("{\"comments\"");
        assertThat(system).doesNotContain("title");
    }

    @Test
    @DisplayName("the company's wording leaves as a labelled user-turn section, never as a system rule")
    void theVoiceReferenceNeverReachesTheSystemTurn() {
        String body = generator(AgentDraftGenerator.Vendor.OPENAI).reviewRequestBody(
                new AgentDraftGenerator.ReviewInput("포장이 아쉬웠어요", List.of(),
                        "안녕하세요, 선바로입니다. 소중한 후기 감사합니다."));
        assertThat(body).contains("회사 기본 문구");
        // Its footer says what it is not, in the same turn as the text itself.
        assertThat(body).contains("사실의 근거가 아닙니다");
        // The system turn is the same bytes for every company. A seller-typed string placed among the
        // fixed rules would let one org edit the rules that write every other org's public replies.
        assertThat(AgentDraftPrompt.reviewSystem()).doesNotContain("선바로");
    }
}
