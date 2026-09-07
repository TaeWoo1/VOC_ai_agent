package com.sellerops.agent.llm.converse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmCallMetrics;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.agent.llm.operator.AgentOperatorResponseParser;
import java.util.List;
import java.util.Optional;

/**
 * The Grounded Conversation call: one request per conversational turn, over {@link AgentLlmTransport}.
 *
 * <p>A separate generator from the plan and judge ones for the reason those two are separate from each
 * other — a distinct exposure gets its own flag, key, prompt, parser and byte-asserted floor. Merging
 * would put two floors in one {@code requestBody} and leave one test standing in front of two contracts.
 *
 * <p><b>Every failure is {@code Optional.empty()}</b> and the caller answers all of them the same way:
 * the deterministic composer writes the sentence instead. That composer is the one that shipped before
 * this package, so an outage here makes the product older, never broken.
 */
public class AgentConverseGenerator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport http;
    private final AgentLlmWireFormat.Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final String version;

    public AgentConverseGenerator(AgentLlmTransport http, AgentLlmWireFormat.Vendor vendor, String modelId,
                                  String apiKey, int maxOutputTokens, String reasoningEffort) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        this.version = "agent-converse/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + AgentConversePrompt.PROMPT_VERSION + "+schema/v1+out" + maxOutputTokens
                + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    public String version() {
        return version;
    }

    /**
     * One turn's grounding.
     *
     * @param facts sentences this deployment can prove about ITSELF, assembled by the runtime from its
     *     tool catalogue, its coverage table and its capability resolver
     * @param context closed {@code key=value} tokens describing where the conversation is standing
     * @param recentTurns the last few sentences of this thread — the seller's and ours
     * @param question the seller's own sentence
     */
    public record Input(List<String> facts, List<String> context, List<String> recentTurns,
                        String question) {
    }

    public record Answer(String text) {
    }

    /**
     * @param metrics what this call cost, in time and the vendor's own token counts. Metadata only —
     *     the same seam the draft capability reports, so the conversation lane's latency and context
     *     size are measurable rather than estimated.
     */
    public record Result(Optional<Answer> answer, String reason, String version,
                         AgentLlmCallMetrics metrics) {

        static Result failed(String version, String reason, AgentLlmCallMetrics metrics) {
            return new Result(Optional.empty(), reason, version, metrics);
        }
    }

    public Result generate(Input input) {
        AgentLlmTransport.Response response =
                http.post(vendor.endpoint(), AgentLlmWireFormat.headers(vendor, apiKey), requestBody(input));
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(response);
        if (response.status() == 0) {
            return Result.failed(version, "transport:" + response.body(), metrics);
        }
        if (!response.ok()) {
            return Result.failed(version, "http:" + response.status(), metrics);
        }
        JsonNode envelope;
        try {
            envelope = MAPPER.readTree(response.body());
        } catch (Exception e) {
            return Result.failed(version, "unreadable_envelope", metrics);
        }
        if (isBudgetExhausted(envelope)) {
            return Result.failed(version, "budget_exhausted", metrics);
        }
        Optional<String> text = AgentOperatorResponseParser.assistantText(response.body());
        if (text.isEmpty()) {
            return Result.failed(version, "no_message_text", metrics);
        }
        return parse(text.get(), metrics);
    }

    /** {@code {"answered":true,"answer":"…"}} — anything else, including 「답할 수 없다」, is empty. */
    private Result parse(String text, AgentLlmCallMetrics metrics) {
        String trimmed = text.trim();
        int open = trimmed.indexOf('{');
        int close = trimmed.lastIndexOf('}');
        if (open < 0 || close <= open) {
            return Result.failed(version, "off_schema", metrics);
        }
        try {
            JsonNode node = MAPPER.readTree(trimmed.substring(open, close + 1));
            if (!node.path("answered").asBoolean(false)) {
                return Result.failed(version, "not_answered", metrics);
            }
            String answer = node.path("answer").asText("").trim();
            return answer.isEmpty()
                    ? Result.failed(version, "empty_answer", metrics)
                    : new Result(Optional.of(new Answer(answer)), "ok", version, metrics);
        } catch (Exception e) {
            return Result.failed(version, "off_schema", metrics);
        }
    }

    /** The whole outgoing payload. Package-private so the payload-floor test asserts the exact string. */
    String requestBody(Input input) {
        return AgentLlmWireFormat.body(vendor, modelId, AgentConversePrompt.system(),
                AgentConversePrompt.user(input.facts(), input.context(), input.recentTurns(),
                        input.question()),
                maxOutputTokens, reasoningEffort);
    }

    private boolean isBudgetExhausted(JsonNode envelope) {
        String stop = vendor == AgentLlmWireFormat.Vendor.ANTHROPIC
                ? envelope.path("stop_reason").asText(null)
                : envelope.path("choices").path(0).path("finish_reason").asText(null);
        return "length".equals(stop) || "max_tokens".equals(stop);
    }
}
