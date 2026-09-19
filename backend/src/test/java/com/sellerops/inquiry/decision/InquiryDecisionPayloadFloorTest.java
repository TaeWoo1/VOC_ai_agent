package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What leaves for Inquiry Decision v2, asserted on the serialized bytes — not on what the code meant to send.
 */
class InquiryDecisionPayloadFloorTest {

    static final Pattern UUID_SHAPE = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    static final UUID ORG = UUID.randomUUID();

    static InquiryDecisionService service(AgentLlmTransport transport) {
        return new InquiryDecisionService(new InquiryDecisionProperties(true, ORG.toString(), "gpt-5-2025-08-07",
                "sk-test", 800, 1600, "minimal"), null, transport);
    }

    static String userTurn(String body) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readTree(body).path("messages").path(1)
                    .path("content").asText();
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    @Test
    @DisplayName("the plan request carries the instruction and the customer's message — nothing else")
    void planFloor() {
        String body = service(null).generator().planBody("원터치 디스펜서 투명 부분은 어떻게 분리하나요?");
        assertThat(userTurn(body)).contains("\"customer\"").contains("분리하나요");
        assertThat(UUID_SHAPE.matcher(body).find()).isFalse();
        assertThat(body).doesNotContain(ORG.toString());
    }

    @Test
    @DisplayName("the judge request names needs, evidence and past answers by position; no id of any kind leaves")
    void judgeFloor() {
        UUID source = UUID.randomUUID();
        UUID product = UUID.randomUUID();
        UUID memory = UUID.randomUUID();
        String body = service(null).generator().judgeBody("질문",
                List.of(new InquiryNeed("N1", "호수", NeedType.PRODUCT_COMPATIBILITY, "호수")),
                List.of(new EvidenceCandidate("E1", EvidenceCandidate.Kind.OPTIONS, "옵션 목록", "색상: 우드 / 사이즈: 1호",
                        source, product, "attr:x")),
                List.of(new PrecedentCandidate("P1", memory, "같은 호수로 사시면 됩니다.")));
        assertThat(userTurn(body)).contains("\"id\":\"N1\"").contains("\"id\":\"E1\"").contains("\"id\":\"P1\"")
                .contains("옵션 목록");
        assertThat(UUID_SHAPE.matcher(body).find()).as("no source, product or memory id").isFalse();
        assertThat(body).doesNotContain("attr:x");
    }

    @Test
    @DisplayName("the instructions carry no product vocabulary — the judgements are about texts, not a domain")
    void noDomainWords() {
        for (String prompt : List.of(InquiryDecisionPrompt.planSystem(), InquiryDecisionPrompt.judgeSystem())) {
            for (String word : List.of("몰딩", "디스펜서", "전선", "종이컵", "호수별", "선바로", "mm")) {
                assertThat(prompt).as(word).doesNotContain(word);
            }
        }
    }

    @Test
    @DisplayName("off, unconfigured or keyless: no call is made and no opinion is given")
    void offMeansNothing() {
        int[] posts = {0};
        AgentLlmTransport counting = (uri, headers, json) -> {
            posts[0]++;
            return new AgentLlmTransport.Response(500, "", 0);
        };
        InquiryDecisionService off = new InquiryDecisionService(new InquiryDecisionProperties(false, ORG.toString(),
                "m", "k", 1, 1, null), null, counting);
        assertThat(off.plan(ORG, "질문").value()).isNull();
        InquiryDecisionService otherOrg = new InquiryDecisionService(new InquiryDecisionProperties(true,
                UUID.randomUUID().toString(), "m", "k", 1, 1, null), null, counting);
        assertThat(otherOrg.plan(ORG, "질문").value()).isNull();
        assertThat(posts[0]).isZero();
        assertThat(InquiryDecisionService.disabled().enabledFor(ORG)).isFalse();
    }

    @Test
    @DisplayName("the same request is answered once — the investigation and the draft do not pay twice")
    void memo() {
        int[] posts = {0};
        AgentLlmTransport answering = (uri, headers, json) -> {
            posts[0]++;
            return new AgentLlmTransport.Response(200,
                    "{\"choices\":[{\"message\":{\"content\":\"{\\\"needs\\\":[{\\\"ask\\\":\\\"a\\\","
                            + "\\\"type\\\":\\\"POLICY\\\"}]}\"}}]}", 10);
        };
        InquiryDecisionService s = service(answering);
        assertThat(s.plan(ORG, "질문").value()).hasSize(1);
        InquiryDecisionModel.Answer<List<InquiryNeed>> again = s.plan(ORG, "질문");
        assertThat(again.value()).hasSize(1);
        assertThat(again.cost().calls()).isZero();
        assertThat(posts[0]).isEqualTo(1);
    }
}
