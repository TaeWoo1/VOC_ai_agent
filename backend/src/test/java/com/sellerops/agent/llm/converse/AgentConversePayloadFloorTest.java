package com.sellerops.agent.llm.converse;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * <b>The Grounded Conversation payload floor, asserted on the serialized bytes.</b>
 *
 * <p>The tenth capability's twin of {@code AgentOperatorPayloadFloorTest}, resting on the same
 * argument: a test that read {@code requestBody}'s intent would keep passing the day someone adds the
 * inquiry body "so the model can see what the customer asked". Every assertion is against the string
 * that goes on the wire.
 *
 * <p>What MAY leave: the seller's own sentence, the sentences this runtime composed earlier in the
 * same thread, this deployment's fact sheet about itself, and closed {@code key=value} tokens saying
 * where the conversation is standing. What may not: anything a customer wrote, and any identifier.
 */
class AgentConversePayloadFloorTest {

    private static final List<String> FORBIDDEN = List.of(
            "7f3a1c9e-0000-4000-8000-000000000001", // orgId
            "9b2d4f60-0000-4000-8000-000000000002", // workItemId
            "김구매",
            "010-1234-5678",
            "buyer@example.com",
            "서울시 강남구",
            "sk-should-never-appear");

    private static final String CUSTOMER_UTTERANCE = "붙였는데 이틀 만에 다 떨어졌어요 환불해주세요";

    private static AgentConverseGenerator generator(AgentLlmWireFormat.Vendor vendor) {
        return new AgentConverseGenerator((uri, headers, body) -> new AgentLlmTransport.Response(200, "{}"),
                vendor, "test-model", "sk-should-never-appear", 2000, "minimal");
    }

    @ParameterizedTest
    @EnumSource(AgentLlmWireFormat.Vendor.class)
    @DisplayName("a converse request carries our facts, our sentences and the seller's question — nothing of the customer's")
    void carriesOnlyFactsAndOurOwnSentences(AgentLlmWireFormat.Vendor vendor) {
        String body = generator(vendor).requestBody(new AgentConverseGenerator.Input(
                List.of("지원하는 판매 채널은 네이버 · 쿠팡 · 카페24입니다.",
                        "쿠팡 리뷰 답글 보내기 — 이 채널은 외부에서 보내는 길이 없습니다."),
                List.of("readiness=NO_CHANNEL focus=NONE"),
                List.of("판매자: 지원하는 이커머스 종류가 뭐가 있지?",
                        "reviewnary: 네이버 · 쿠팡 · 카페24를 지원합니다."),
                "연동하고 나면 뭐가 되냐고"));

        assertThat(body).as("the four things that MAY leave are there")
                .contains("연동하고 나면 뭐가 되냐고")
                .contains("지원하는 판매 채널은")
                .contains("readiness=NO_CHANNEL")
                .contains("네이버 · 쿠팡 · 카페24를 지원합니다");
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
        assertThat(body).as("no customer utterance is anywhere near this capability")
                .doesNotContain(CUSTOMER_UTTERANCE);
    }

    @Test
    @DisplayName("the request shape has four sections and no place to put an object id")
    void theShapeItselfIsTheFloor() {
        // A record's components ARE the wire contract: a caller cannot pass a review body or an id
        // through a field that does not exist, and adding one is a visible edit to this list.
        assertThat(AgentConverseGenerator.Input.class.getRecordComponents())
                .extracting(java.lang.reflect.RecordComponent::getName)
                .containsExactly("facts", "context", "recentTurns", "question");
    }

    @Test
    @DisplayName("the envelope line must be closed tokens — a sentence in it is refused, not truncated")
    void envelopeLinesAreClosedTokens() {
        assertThat(ConverseRequestFloor.isSafe("질문", List.of("사실"),
                List.of("readiness=NO_CHANNEL focus=REVIEW"), List.of())).isTrue();
        // The one line where an id, a product name or a customer sentence would appear if the envelope
        // ever grew one.
        assertThat(ConverseRequestFloor.isSafe("질문", List.of("사실"),
                List.of("focus=이 고객이 접착이 떨어졌다고 합니다"), List.of())).isFalse();
        assertThat(ConverseRequestFloor.isSafe("질문", List.of("사실"),
                List.of("붙였는데 이틀 만에 떨어졌어요"), List.of())).isFalse();
    }

    @Test
    @DisplayName("an unbounded fact sheet or thread excerpt is refused")
    void sizeIsTheOtherFloor() {
        assertThat(ConverseRequestFloor.isSafe("질문",
                java.util.Collections.nCopies(ConverseRequestFloor.MAX_FACTS + 1, "사실"),
                List.of(), List.of())).isFalse();
        assertThat(ConverseRequestFloor.isSafe("질문", List.of("사실"), List.of(),
                java.util.Collections.nCopies(ConverseRequestFloor.MAX_TURNS + 1, "판매자: 안녕"))).isFalse();
        assertThat(ConverseRequestFloor.isSafe("질문", List.of("사실"), List.of(),
                List.of("판매자: " + "가".repeat(ConverseRequestFloor.MAX_TURN_LENGTH)))).isFalse();
        // No facts at all is refused too: a model asked to answer from nothing is a model inventing.
        assertThat(ConverseRequestFloor.isSafe("질문", List.of(), List.of(), List.of())).isFalse();
    }
}
