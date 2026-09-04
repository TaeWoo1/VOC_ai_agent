package com.sellerops.agent.llm.report;

import com.sellerops.agent.llm.operator.AgentOperatorProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.agent.report.*} — the report narrative's switch (Agentic Report v1, 2026-09-04).
 *
 * <p>The ninth LLM capability, and its own flag for the reason the other eight are: what leaves is a
 * different thing. This one sends a {@code ReportFacts} snapshot — counts, dates, closed-vocabulary
 * issue titles, the seller's own product names, opportunity labels — and nothing a customer wrote.
 * Off in three independent ways like the rest; when it is off the deterministic summary is the whole
 * report, so turning it off makes the report shorter, never wrong.
 */
@Component
public class AgentReportProperties extends AgentOperatorProperties {

    public AgentReportProperties(
            @Value("${sellerops.agent.report.enabled:false}") boolean enabled,
            @Value("${sellerops.agent.report.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.agent.report.vendor:OPENAI}") String vendor,
            @Value("${sellerops.agent.report.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.agent.report.api-key:}") String apiKey,
            @Value("${sellerops.agent.report.max-output-tokens:3000}") int maxOutputTokens,
            @Value("${sellerops.agent.report.reasoning-effort:low}") String reasoningEffort) {
        super(enabled, enabledOrgIds, vendor, model, apiKey, maxOutputTokens, reasoningEffort);
    }

    @Override
    public String capabilityName() {
        return "SELLEROPS_AGENT_REPORT";
    }
}
