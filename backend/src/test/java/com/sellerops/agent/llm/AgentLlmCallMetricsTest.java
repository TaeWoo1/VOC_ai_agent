package com.sellerops.agent.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Agent Responsiveness v1 §1 — the measurement the repository could not take.
 *
 * <p>The counts these assertions pin are the ones that separated four different explanations for a
 * 30-second turn: a large prompt, a slow network, a queue, or a reasoning model spending its output
 * budget thinking. Only the last one shows up as reasoning tokens, and only the reasoning tokens told
 * us which lever to pull — so the reader has to be right about which number is which.
 */
class AgentLlmCallMetricsTest {

    private static final String OPENAI = """
            {"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}],
             "usage":{"prompt_tokens":5549,"completion_tokens":629,
                      "completion_tokens_details":{"reasoning_tokens":320}}}
            """;

    private static final String ANTHROPIC = """
            {"content":[{"type":"text","text":"{}"}],"stop_reason":"end_turn",
             "usage":{"input_tokens":4000,"output_tokens":300}}
            """;

    @Test
    @DisplayName("reads the OpenAI usage block, reasoning tokens included")
    void readsOpenAiUsage() {
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(new AgentLlmTransport.Response(200, OPENAI, 11_214L));
        assertThat(metrics.elapsedMs()).isEqualTo(11_214L);
        assertThat(metrics.promptTokens()).isEqualTo(5549);
        assertThat(metrics.completionTokens()).isEqualTo(629);
        assertThat(metrics.reasoningTokens()).isEqualTo(320);
        assertThat(metrics.toLogFields()).isEqualTo("ms=11214 inTok=5549 outTok=629 reasoningTok=320");
    }

    @Test
    @DisplayName("reads the Anthropic usage block, and reports NO reasoning figure rather than zero")
    void readsAnthropicUsage() {
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(new AgentLlmTransport.Response(200, ANTHROPIC, 900L));
        assertThat(metrics.promptTokens()).isEqualTo(4000);
        assertThat(metrics.completionTokens()).isEqualTo(300);
        // The vendor does not report one. A zero here would average into a cost report as a free call.
        assertThat(metrics.reasoningTokens()).isEqualTo(AgentLlmCallMetrics.UNREPORTED);
    }

    @Test
    @DisplayName("a failed call still carries its duration — a slow failure is the interesting kind")
    void timesFailures() {
        AgentLlmCallMetrics timeout = AgentLlmCallMetrics.of(new AgentLlmTransport.Response(0, "HttpTimeoutException", 60_000L));
        assertThat(timeout.elapsedMs()).isEqualTo(60_000L);
        assertThat(timeout.promptTokens()).isEqualTo(AgentLlmCallMetrics.UNREPORTED);

        AgentLlmCallMetrics rateLimited = AgentLlmCallMetrics.of(new AgentLlmTransport.Response(429, "{}", 120L));
        assertThat(rateLimited.elapsedMs()).isEqualTo(120L);
        assertThat(rateLimited.completionTokens()).isEqualTo(AgentLlmCallMetrics.UNREPORTED);
    }

    @Test
    @DisplayName("an unreadable or usage-less body is unreported, never a guessed zero, and never throws")
    void survivesGarbage() {
        assertThat(AgentLlmCallMetrics.of(new AgentLlmTransport.Response(200, "not json", 5L)).promptTokens())
                .isEqualTo(AgentLlmCallMetrics.UNREPORTED);
        assertThat(AgentLlmCallMetrics.of(new AgentLlmTransport.Response(200, "{\"choices\":[]}", 5L)).completionTokens())
                .isEqualTo(AgentLlmCallMetrics.UNREPORTED);
        assertThat(AgentLlmCallMetrics.of(null).elapsedMs()).isZero();
    }

    @Test
    @DisplayName("nothing but numbers leaves — the log fragment cannot carry a prompt or an answer")
    void metadataOnly() {
        String fields = AgentLlmCallMetrics.of(new AgentLlmTransport.Response(200, OPENAI, 11_214L)).toLogFields();
        assertThat(fields).doesNotContain("choices", "content", "message", "{");
        assertThat(fields).matches("ms=\\d+ inTok=-?\\d+ outTok=-?\\d+ reasoningTok=-?\\d+");
    }
}
