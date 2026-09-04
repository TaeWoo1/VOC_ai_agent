package com.sellerops.agent.llm.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmCallMetrics;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.agent.llm.operator.AgentOperatorResponseParser;
import com.sellerops.report.ReportNarrative;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The narrative call: one request per report generation, over {@link AgentLlmTransport}.
 *
 * <p>Same shape as {@code AgentPlanGenerator}: {@link #requestBody} is the only place a request is
 * built and it reads exactly one value — the facts snapshot as JSON. Every failure is
 * {@link Optional#empty()} with a coarse reason marker for the log (never vendor body text), and the
 * caller has one response to all of them: the deterministic summary stands alone.
 *
 * <p>What comes back is parsed into a RAW {@link ReportNarrative}; it is not trusted here. The guard
 * in the report package decides which lines a seller sees.
 */
public class AgentReportNarrativeGenerator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport http;
    private final AgentLlmWireFormat.Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final String version;

    public AgentReportNarrativeGenerator(AgentLlmTransport http, AgentLlmWireFormat.Vendor vendor, String modelId,
                                         String apiKey, int maxOutputTokens, String reasoningEffort) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        this.version = "agent-report/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + AgentReportPrompt.PROMPT_VERSION + "+schema/v1+out" + maxOutputTokens
                + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    public String version() {
        return version;
    }

    public record Result(Optional<ReportNarrative> narrative, String reason, String version,
                         AgentLlmCallMetrics metrics) {

        static Result failed(String version, String reason, AgentLlmCallMetrics metrics) {
            return new Result(Optional.empty(), reason, version, metrics);
        }
    }

    public Result generate(String factsJson) {
        AgentLlmTransport.Response response =
                http.post(vendor.endpoint(), AgentLlmWireFormat.headers(vendor, apiKey), requestBody(factsJson));
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(response);
        if (response.status() == 0) {
            return Result.failed(version, "transport:" + response.body(), metrics);
        }
        if (!response.ok()) {
            return Result.failed(version, "http:" + response.status(), metrics);
        }
        Optional<String> text = AgentOperatorResponseParser.assistantText(response.body());
        if (text.isEmpty()) {
            return Result.failed(version, "no_message_text", metrics);
        }
        Optional<ReportNarrative> parsed = parse(text.get());
        return parsed.map(n -> new Result(Optional.of(n), "ok", version, metrics))
                .orElseGet(() -> Result.failed(version, "off_schema", metrics));
    }

    /** The whole outgoing payload. Package-private so the payload-floor test can assert the bytes. */
    String requestBody(String factsJson) {
        return AgentLlmWireFormat.body(vendor, modelId, AgentReportPrompt.system(),
                AgentReportPrompt.user(factsJson), maxOutputTokens, reasoningEffort);
    }

    /** The schema, read strictly: a line without a text or without a facts array is not a line. */
    static Optional<ReportNarrative> parse(String assistantText) {
        try {
            JsonNode root = MAPPER.readTree(AgentOperatorResponseParser.stripFence(assistantText));
            if (root == null || !root.isObject()) {
                return Optional.empty();
            }
            String headline = root.path("headline").isTextual() ? root.path("headline").asText() : null;
            List<ReportNarrative.Line> lines = new ArrayList<>();
            for (JsonNode line : root.path("lines")) {
                if (!line.path("text").isTextual() || !line.path("facts").isArray()) {
                    continue;
                }
                List<String> ids = new ArrayList<>();
                for (JsonNode id : line.path("facts")) {
                    if (id.isTextual()) {
                        ids.add(id.asText());
                    }
                }
                lines.add(new ReportNarrative.Line(line.path("text").asText(), List.copyOf(ids)));
            }
            return Optional.of(new ReportNarrative(headline, List.copyOf(lines)));
        } catch (Exception e) {
            return Optional.empty();
        }
    }
}
