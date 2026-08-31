package com.sellerops.agent.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * What one model call COST, in time and tokens. Metadata only — never a prompt, never an answer.
 *
 * <p><b>Why this exists.</b> Agent Responsiveness v1 began with a measurement, and the measurement was
 * not takeable: the only latency number the repository produced was {@code operator_stage plan ms} in
 * {@code agent-runtime}, which covers its own HTTP call, this backend, the network and the vendor's
 * generation as one figure. A 30-second turn could have been a large prompt, a slow network, a queue,
 * or a reasoning model spending its output budget thinking — four different problems with four
 * different fixes, and no way to tell them apart. The token counts are what separate them: reasoning
 * tokens dominating means the fix is the model and the effort setting, while a small answer arriving
 * slowly means the fix is somewhere else entirely.
 *
 * <p><b>The payload floor is untouched.</b> Nothing here reads the request or the assistant's text. It
 * reads the vendor's own {@code usage} block, which is four integers, and a duration the transport
 * measured. Absent or unparseable usage is {@code -1} — "not reported", never a guessed zero, because a
 * zero would average into a cost report as a free call.
 */
public record AgentLlmCallMetrics(long elapsedMs, int promptTokens, int completionTokens, int reasoningTokens) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** The value for a count the vendor did not report. */
    public static final int UNREPORTED = -1;

    private static final AgentLlmCallMetrics NONE =
            new AgentLlmCallMetrics(0L, UNREPORTED, UNREPORTED, UNREPORTED);

    /**
     * Read the usage block of a vendor response.
     *
     * <p>Both wire formats are handled because both are configurable per capability: OpenAI reports
     * {@code usage.prompt_tokens} / {@code completion_tokens} with reasoning nested inside
     * {@code completion_tokens_details}, Anthropic reports {@code usage.input_tokens} /
     * {@code output_tokens} and no separate reasoning figure.
     */
    public static AgentLlmCallMetrics of(AgentLlmTransport.Response response) {
        if (response == null) {
            return NONE;
        }
        if (!response.ok()) {
            // A failed call still has a duration, and a slow failure is the interesting kind.
            return new AgentLlmCallMetrics(response.elapsedMs(), UNREPORTED, UNREPORTED, UNREPORTED);
        }
        JsonNode usage;
        try {
            usage = MAPPER.readTree(response.body()).path("usage");
        } catch (Exception e) {
            return new AgentLlmCallMetrics(response.elapsedMs(), UNREPORTED, UNREPORTED, UNREPORTED);
        }
        int prompt = intOf(usage, "prompt_tokens", "input_tokens");
        int completion = intOf(usage, "completion_tokens", "output_tokens");
        int reasoning = usage.path("completion_tokens_details").path("reasoning_tokens").isNumber()
                ? usage.path("completion_tokens_details").path("reasoning_tokens").asInt()
                : UNREPORTED;
        return new AgentLlmCallMetrics(response.elapsedMs(), prompt, completion, reasoning);
    }

    private static int intOf(JsonNode usage, String openAiField, String anthropicField) {
        if (usage.path(openAiField).isNumber()) {
            return usage.path(openAiField).asInt();
        }
        return usage.path(anthropicField).isNumber() ? usage.path(anthropicField).asInt() : UNREPORTED;
    }

    /** One log fragment, in the shape the existing {@code agent_*} lines already use. */
    public String toLogFields() {
        return "ms=" + elapsedMs + " inTok=" + promptTokens + " outTok=" + completionTokens
                + " reasoningTok=" + reasoningTokens;
    }
}
