package com.sellerops.agent.llm.goal;

import com.sellerops.agent.llm.AgentLlmCallMetrics;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.agent.llm.operator.AgentOperatorResponseParser;
import com.sellerops.inquiry.goal.CustomerGoalPrompt;
import com.sellerops.inquiry.goal.CustomerGoalResponseParser;
import java.util.Optional;

/**
 * One call to the goal interpreter.
 *
 * <p>The prompt, the schema and the parser are all {@code customer-goal-interpreter/v3}'s own — frozen, evaluated,
 * and shared with the evaluation runner. Nothing here decides anything about the contract; it carries one sentence
 * out and reads one answer back.
 *
 * <h2>The payload is the customer's sentence</h2>
 *
 * <p>{@link CustomerGoalPrompt#user} takes a capability snapshot and this passes <b>null</b>. That is not a
 * shortcut: a null snapshot renders two constants ({@code PUBLIC_QNA}, {@code listing_resolved:false}) rather than
 * this seller's situation, and it is <b>exactly what the frozen holdout measured</b> — the evaluation runner
 * passes null too. So the shipped payload is byte-identical in shape to the one the evidence came from, and no
 * order, product, knowledge or resolution state can reach the vendor because none is ever assembled.
 */
public class InquiryGoalGenerator {

    private final AgentLlmTransport http;
    private final AgentLlmWireFormat.Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final String version;

    public InquiryGoalGenerator(AgentLlmTransport http, AgentLlmWireFormat.Vendor vendor, String modelId,
                                String apiKey, int maxOutputTokens, String reasoningEffort) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        this.version = CustomerGoalPrompt.VERSION + "+" + vendor.name().toLowerCase() + ":" + modelId
                + "+out" + maxOutputTokens + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    public String version() {
        return version;
    }

    public String model() {
        return modelId;
    }

    /**
     * @param parsed  the reading, present only when the contract accepted the whole answer
     * @param reason  {@code ok}, a transport/http token, or the parser's own refusal token
     */
    public record Result(Optional<CustomerGoalResponseParser.Parsed> parsed, String reason, String version,
                         String model, AgentLlmCallMetrics metrics) {

        static Result failed(String version, String model, String reason, AgentLlmCallMetrics metrics) {
            return new Result(Optional.empty(), reason, version, model, metrics);
        }

        /** Whether the model answered and the answer simply did not satisfy the contract. */
        public boolean contractRefusal() {
            return parsed.isPresent() && parsed.get().refused();
        }
    }

    public Result generate(String customerMessage) {
        AgentLlmTransport.Response response =
                http.post(vendor.endpoint(), AgentLlmWireFormat.headers(vendor, apiKey),
                        requestBody(customerMessage));
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(response);
        if (response.status() == 0) {
            return Result.failed(version, modelId, "transport", metrics);
        }
        if (!response.ok()) {
            return Result.failed(version, modelId, "http:" + response.status(), metrics);
        }
        Optional<String> text = AgentOperatorResponseParser.assistantText(response.body());
        if (text.isEmpty()) {
            return Result.failed(version, modelId, "no_message_text", metrics);
        }
        // A refusal by the contract is still an answer: it is recorded, because the same bytes will refuse again.
        CustomerGoalResponseParser.Parsed parsed = CustomerGoalResponseParser.parse(
                AgentOperatorResponseParser.stripFence(text.get()), customerMessage);
        return new Result(Optional.of(parsed), parsed.refused() ? parsed.failure() : "ok", version, modelId, metrics);
    }

    /** The whole outgoing payload. Package-private so the payload-floor test can assert the bytes. */
    String requestBody(String customerMessage) {
        return AgentLlmWireFormat.body(vendor, modelId, CustomerGoalPrompt.system(),
                CustomerGoalPrompt.user(customerMessage, null), maxOutputTokens, reasoningEffort,
                CustomerGoalPrompt.responseFormat());
    }
}
