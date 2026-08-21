package com.sellerops.agent.llm.operator;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.Optional;

/**
 * The Evidence Judge call: one request per finding, over {@link AgentLlmTransport}.
 *
 * <p><b>A separate generator from {@link AgentPlanGenerator}, deliberately.</b> They are different
 * exposures with different payload floors — a goal sentence plus a static catalogue, versus a
 * SellerOps-authored claim plus evidence metadata — and the repository's standing rule is that a
 * distinct exposure gets its own flag, key, prompt, parser and byte-asserted floor. Merging them into
 * one "operator LLM" class would have put two floors in one {@code requestBody} and left one test
 * standing in front of two contracts, which is precisely what {@code ClassifierBoundaryTest} and
 * {@code AgentDraftBoundaryTest} exist to prevent.
 *
 * <p><b>Every failure is {@code Optional.empty()}</b> and the caller answers all of them the same way:
 * the deterministic rule judge decides instead. The rule judge is the conservative one, so a judge
 * outage makes the Operator quieter rather than bolder.
 */
public class AgentJudgeGenerator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport http;
    private final AgentLlmWireFormat.Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final String version;

    public AgentJudgeGenerator(AgentLlmTransport http, AgentLlmWireFormat.Vendor vendor, String modelId,
                               String apiKey, int maxOutputTokens, String reasoningEffort) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        this.version = "agent-judge/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + AgentJudgePrompt.PROMPT_VERSION + "+schema/v1+out" + maxOutputTokens
                + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    public String version() {
        return version;
    }

    /**
     * One claim and the metadata behind it.
     *
     * @param finding a sentence SellerOps composed — never a customer utterance
     * @param evidenceDigest closed-vocabulary labels, counts, coverage verdicts and ISO dates, one per
     *     line, built by the caller from an allow-list
     */
    public record Input(String finding, String evidenceDigest) {
    }

    public record Result(Optional<AgentOperatorResponseParser.ParsedVerdict> verdict, String reason,
                         String version) {

        static Result failed(String version, String reason) {
            return new Result(Optional.empty(), reason, version);
        }
    }

    public Result generate(Input input) {
        AgentLlmTransport.Response response =
                http.post(vendor.endpoint(), AgentLlmWireFormat.headers(vendor, apiKey), requestBody(input));
        if (response.status() == 0) {
            return Result.failed(version, "transport:" + response.body());
        }
        if (!response.ok()) {
            return Result.failed(version, "http:" + response.status());
        }
        JsonNode envelope;
        try {
            envelope = MAPPER.readTree(response.body());
        } catch (Exception e) {
            return Result.failed(version, "unreadable_envelope");
        }
        if (isBudgetExhausted(envelope)) {
            return Result.failed(version, "budget_exhausted");
        }
        Optional<String> text = AgentOperatorResponseParser.assistantText(response.body());
        if (text.isEmpty()) {
            return Result.failed(version, "no_message_text");
        }
        Optional<AgentOperatorResponseParser.ParsedVerdict> parsed =
                AgentOperatorResponseParser.parseVerdict(text.get());
        return parsed.map(v -> new Result(Optional.of(v), "ok", version))
                .orElseGet(() -> Result.failed(version, "off_schema"));
    }

    /** The whole outgoing payload. Package-private so the payload-floor test asserts the exact string. */
    String requestBody(Input input) {
        return AgentLlmWireFormat.body(vendor, modelId, AgentJudgePrompt.system(),
                AgentJudgePrompt.user(input.finding(), input.evidenceDigest()),
                maxOutputTokens, reasoningEffort);
    }

    private boolean isBudgetExhausted(JsonNode envelope) {
        String stop = vendor == AgentLlmWireFormat.Vendor.ANTHROPIC
                ? envelope.path("stop_reason").asText(null)
                : envelope.path("choices").path(0).path("finish_reason").asText(null);
        return "length".equals(stop) || "max_tokens".equals(stop);
    }
}
