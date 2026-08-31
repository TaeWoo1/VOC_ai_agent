package com.sellerops.agent.llm.operator;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmCallMetrics;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.List;
import java.util.Optional;

/**
 * The goal-interpretation call: one request per Operator run, over {@link AgentLlmTransport}.
 *
 * <p><b>This is the LLM behind {@code parseGoal}</b> — the seam
 * {@code docs/decisions/agent-runtime-langgraph-llm-split.md} left explicitly open ("Filling it is the
 * same shape of decision and has not been made") and that scope lock v1.12 makes. It follows the same
 * shape as {@code AgentDraftGenerator} for the same reasons, and it keeps the property that made that
 * decision affordable: the model is a BACKEND capability, so {@code agent-runtime} still holds no
 * vendor key and the backend is still the only LLM egress.
 *
 * <p><b>The payload floor lives here.</b> {@link #requestBody} is the only place a request is built and
 * it reads exactly two values: the operator's own goal sentence, and the static tool catalogue.
 * {@code AgentPlanPayloadFloorTest} asserts the serialized bytes.
 *
 * <p><b>Every failure is {@code Optional.empty()}</b>, and the caller has one response to all of them:
 * fall back to the deterministic keyword router. So a refusal, a timeout and an off-schema answer are
 * the same event to everyone upstream, which is why they are not distinguished beyond a coarse reason
 * marker for the log (never vendor body text — an error body can quote the request).
 */
public class AgentPlanGenerator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport http;
    private final AgentLlmWireFormat.Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final String version;

    public AgentPlanGenerator(AgentLlmTransport http, AgentLlmWireFormat.Vendor vendor, String modelId,
                              String apiKey, int maxOutputTokens, String reasoningEffort) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        // Everything that decides what a plan is, in one string, so a recorded run reads back without
        // consulting configuration — the discipline the draft and triage version strings already carry.
        this.version = "agent-plan/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + AgentPlanPrompt.PROMPT_VERSION + "+schema/v1+out" + maxOutputTokens
                + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    public String version() {
        return version;
    }

    /** The operator's own words, and the catalogue they may be planned against. Nothing else. */
    public record Input(String goalText, List<String> toolCatalogue, String priorContext) {

        /** The first plan of a run — no progress line yet. */
        public Input(String goalText, List<String> toolCatalogue) {
            this(goalText, toolCatalogue, null);
        }
    }

    /**
     * @param metrics what the call cost in time and tokens — never null, and reported on every path
     *     including the failures, because a plan that times out is the slowest turn a seller can have
     */
    public record Result(Optional<AgentOperatorResponseParser.ParsedPlan> plan, String reason, String version,
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
            // The status only. A vendor error body can quote the request.
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
        Optional<AgentOperatorResponseParser.ParsedPlan> parsed =
                AgentOperatorResponseParser.parsePlan(text.get());
        return parsed.map(p -> new Result(Optional.of(p), "ok", version, metrics))
                .orElseGet(() -> Result.failed(version, "off_schema", metrics));
    }

    /**
     * The whole outgoing payload.
     *
     * <p>Package-private so the payload-floor test can assert the exact string. A check on what this
     * method <i>meant</i> to send would keep passing after someone added the org id "for correlation".
     */
    String requestBody(Input input) {
        return AgentLlmWireFormat.body(vendor, modelId, AgentPlanPrompt.system(),
                AgentPlanPrompt.user(input.goalText(), input.toolCatalogue(), input.priorContext()),
                maxOutputTokens, reasoningEffort);
    }

    /** Output budget spent on reasoning rather than an answer — fixable by config, so named separately. */
    private boolean isBudgetExhausted(JsonNode envelope) {
        String stop = vendor == AgentLlmWireFormat.Vendor.ANTHROPIC
                ? envelope.path("stop_reason").asText(null)
                : envelope.path("choices").path(0).path("finish_reason").asText(null);
        return "length".equals(stop) || "max_tokens".equals(stop);
    }
}
