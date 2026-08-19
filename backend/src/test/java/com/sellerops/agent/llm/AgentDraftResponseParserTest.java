package com.sellerops.agent.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Fail-closed validation of the model's answer.
 *
 * <p>Every refusal below is a shape a model has actually been seen to produce. The reason each one is
 * a refusal rather than a repair: a partial candidate reaches a human as a draft that LOOKS reviewed,
 * and the fallback — a deterministic rule draft — is a better thing to show than half a generated one.
 */
class AgentDraftResponseParserTest {

    private static final String GOOD =
            "{\"category\":\"delivery_status_reply\",\"title\":\"[답변] 배송 문의\",\"comments\":\"확인 후 안내드리겠습니다.\"}";

    @Test
    @DisplayName("a well-formed answer parses into all three fields")
    void parsesTheContract() {
        var parsed = AgentDraftResponseParser.parse(GOOD).orElseThrow();
        assertThat(parsed.category()).isEqualTo("delivery_status_reply");
        assertThat(parsed.title()).isEqualTo("[답변] 배송 문의");
        assertThat(parsed.comments()).isEqualTo("확인 후 안내드리겠습니다.");
    }

    @Test
    @DisplayName("a ```json fence is stripped — it wraps the answer without changing it")
    void stripsACodeFence() {
        assertThat(AgentDraftResponseParser.parse("```json\n" + GOOD + "\n```")).isPresent();
        assertThat(AgentDraftResponseParser.parse("```\n" + GOOD + "\n```")).isPresent();
    }

    @Test
    @DisplayName("an invented category is refused — the vocabulary is closed")
    void refusesAnUnknownCategory() {
        assertThat(AgentDraftResponseParser.parse(
                "{\"category\":\"apology_reply\",\"title\":\"t\",\"comments\":\"c\"}")).isEmpty();
    }

    @Test
    @DisplayName("a blank or missing field is refused, never defaulted")
    void refusesBlankFields() {
        assertThat(AgentDraftResponseParser.parse(
                "{\"category\":\"general_reply\",\"title\":\"t\",\"comments\":\"   \"}")).isEmpty();
        assertThat(AgentDraftResponseParser.parse(
                "{\"category\":\"general_reply\",\"title\":\"t\"}")).isEmpty();
        assertThat(AgentDraftResponseParser.parse(
                "{\"category\":\"general_reply\",\"title\":null,\"comments\":\"c\"}")).isEmpty();
    }

    @Test
    @DisplayName("prose, a preamble, or a non-object is refused")
    void refusesProse() {
        assertThat(AgentDraftResponseParser.parse("물론이죠! 아래와 같이 답변드립니다. " + GOOD)).isEmpty();
        assertThat(AgentDraftResponseParser.parse("[" + GOOD + "]")).isEmpty();
        assertThat(AgentDraftResponseParser.parse("")).isEmpty();
        assertThat(AgentDraftResponseParser.parse(null)).isEmpty();
    }

    @Test
    @DisplayName("an essay is refused — a starter draft has a bound")
    void refusesAnOverLongBody() {
        String huge = "가".repeat(2001);
        assertThat(AgentDraftResponseParser.parse(
                "{\"category\":\"general_reply\",\"title\":\"t\",\"comments\":\"" + huge + "\"}")).isEmpty();
    }

    @Test
    @DisplayName("both vendors' envelopes are read — the vendor is configuration, not whoever was written first")
    void readsBothEnvelopes() {
        assertThat(AgentDraftResponseParser.assistantText("{\"content\":[{\"text\":\"hi\"}]}")).contains("hi");
        assertThat(AgentDraftResponseParser.assistantText("{\"choices\":[{\"message\":{\"content\":\"hi\"}}]}"))
                .contains("hi");
        assertThat(AgentDraftResponseParser.assistantText("{\"unexpected\":true}")).isEmpty();
        assertThat(AgentDraftResponseParser.assistantText("not json")).isEmpty();
    }
}
