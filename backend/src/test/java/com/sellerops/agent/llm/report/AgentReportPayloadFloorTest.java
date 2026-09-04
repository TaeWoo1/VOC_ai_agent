package com.sellerops.agent.llm.report;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * The report narrative's payload floor, on the serialized bytes: the facts JSON the caller built and
 * nothing the caller might also have in hand.
 */
class AgentReportPayloadFloorTest {

    private static final List<String> FORBIDDEN = List.of(
            "7f3a1c9e-0000-4000-8000-000000000001", // orgId
            "김구매", "010-1234-5678", "buyer@example.com", "서울시 강남구",
            "sk-should-never-appear");

    private static final String CUSTOMER_UTTERANCE = "붙였는데 이틀 만에 다 떨어졌어요 환불해주세요";

    private static AgentReportNarrativeGenerator generator(AgentLlmWireFormat.Vendor vendor) {
        return new AgentReportNarrativeGenerator((uri, headers, body) -> new AgentLlmTransport.Response(200, "{}"),
                vendor, "test-model", "sk-should-never-appear", 3000, "low");
    }

    @ParameterizedTest
    @EnumSource(AgentLlmWireFormat.Vendor.class)
    void theRequestCarriesTheFactsAndNothingElse(AgentLlmWireFormat.Vendor vendor) {
        String facts = "{\"counters\":[{\"id\":\"c-reviews\",\"labelKo\":\"받은 리뷰\",\"current\":81}],"
                + "\"issues\":[{\"id\":\"i-1\",\"title\":\"접착 부족\",\"current\":4,\"previous\":1}]}";
        String body = generator(vendor).requestBody(facts);

        assertThat(body).contains("c-reviews").contains("접착 부족");
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
        assertThat(body).doesNotContain(CUSTOMER_UTTERANCE);
    }

    @ParameterizedTest
    @EnumSource(AgentLlmWireFormat.Vendor.class)
    void theVersionStringCarriesNoKey(AgentLlmWireFormat.Vendor vendor) {
        assertThat(generator(vendor).version()).doesNotContain("sk-should-never-appear")
                .contains(AgentReportPrompt.PROMPT_VERSION);
    }
}
