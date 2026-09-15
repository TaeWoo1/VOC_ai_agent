package com.sellerops.operationscase.investigation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmCallMetrics;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.agent.llm.operator.AgentOperatorResponseParser;
import com.sellerops.operationscase.CaseConfidence;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.OperationsCaseKind;
import com.sellerops.operationscase.RecommendedActionType;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The investigation call: one request per case that needs one, over {@link AgentLlmTransport}.
 *
 * <p>{@link #requestBody} is the only place a request is built and it reads exactly one value — the context the
 * investigator gathered. Every failure is {@link Optional#empty()} with a coarse reason for the log (never vendor
 * body text). What comes back is parsed strictly; it is not trusted — {@code CaseDecisionGuard} decides what stands.
 */
public class CaseInvestigationGenerator {

    static final int MAX_SUMMARY = 400;
    static final int MAX_ACTION = 300;
    static final int MAX_MISSING_ITEMS = 5;
    static final int MAX_MISSING_LENGTH = 120;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport http;
    private final AgentLlmWireFormat.Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final String version;

    public CaseInvestigationGenerator(AgentLlmTransport http, AgentLlmWireFormat.Vendor vendor, String modelId,
                                      String apiKey, int maxOutputTokens, String reasoningEffort) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        this.version = "case-investigation/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + CaseInvestigationPrompt.PROMPT_VERSION + "+" + CaseInvestigationPrompt.SCHEMA_VERSION
                + "+out" + maxOutputTokens + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    public String version() {
        return version;
    }

    public String model() {
        return modelId;
    }

    public record Result(Optional<CaseInvestigationOutput> output, String reason, String version, String model,
                         AgentLlmCallMetrics metrics) {

        static Result failed(String version, String model, String reason, AgentLlmCallMetrics metrics) {
            return new Result(Optional.empty(), reason, version, model, metrics);
        }
    }

    public Result generate(String context) {
        AgentLlmTransport.Response response =
                http.post(vendor.endpoint(), AgentLlmWireFormat.headers(vendor, apiKey), requestBody(context));
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
        return parse(text.get())
                .map(out -> new Result(Optional.of(out), "ok", version, modelId, metrics))
                .orElseGet(() -> Result.failed(version, modelId, "off_schema", metrics));
    }

    /** The whole outgoing payload. Package-private so the payload-floor test can assert the bytes. */
    String requestBody(String context) {
        return AgentLlmWireFormat.body(vendor, modelId, CaseInvestigationPrompt.system(),
                CaseInvestigationPrompt.user(context), maxOutputTokens, reasoningEffort);
    }

    /** The schema, read strictly. Any missing field, unknown token or wrong type is not an investigation. */
    static Optional<CaseInvestigationOutput> parse(String assistantText) {
        try {
            JsonNode root = MAPPER.readTree(AgentOperatorResponseParser.stripFence(assistantText));
            if (root == null || !root.isObject()) {
                return Optional.empty();
            }
            OperationsCaseKind kind = token(root, "caseKind", OperationsCaseKind.class);
            CaseDisposition disposition = token(root, "disposition", CaseDisposition.class);
            RecommendedActionType action = token(root, "recommendedActionType", RecommendedActionType.class);
            CaseConfidence confidence = token(root, "confidence", CaseConfidence.class);
            String summary = text(root, "summary", MAX_SUMMARY);
            String recommended = text(root, "recommendedAction", MAX_ACTION);
            if (kind != OperationsCaseKind.CUSTOMER_WORK || disposition == null || action == null
                    || confidence == null || summary == null || recommended == null
                    || !root.path("missingInformation").isArray() || !root.path("evidenceRefs").isArray()) {
                return Optional.empty();
            }
            List<String> missing = new ArrayList<>();
            for (JsonNode item : root.path("missingInformation")) {
                if (!item.isTextual()) {
                    return Optional.empty();
                }
                String value = item.asText().strip();
                if (!value.isEmpty() && missing.size() < MAX_MISSING_ITEMS) {
                    missing.add(value.length() > MAX_MISSING_LENGTH ? value.substring(0, MAX_MISSING_LENGTH) : value);
                }
            }
            List<String> refs = new ArrayList<>();
            for (JsonNode item : root.path("evidenceRefs")) {
                if (!item.isTextual()) {
                    return Optional.empty();
                }
                refs.add(item.asText().strip());
            }
            if (refs.isEmpty()) {
                return Optional.empty();
            }
            return Optional.of(new CaseInvestigationOutput(kind, disposition, summary, action, recommended,
                    missing, refs, confidence));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private static <E extends Enum<E>> E token(JsonNode root, String field, Class<E> type) {
        JsonNode node = root.path(field);
        if (!node.isTextual()) {
            return null;
        }
        try {
            return Enum.valueOf(type, node.asText().strip());
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    private static String text(JsonNode root, String field, int max) {
        JsonNode node = root.path(field);
        if (!node.isTextual() || node.asText().isBlank()) {
            return null;
        }
        String value = node.asText().strip();
        return value.length() > max ? value.substring(0, max) : value;
    }
}
