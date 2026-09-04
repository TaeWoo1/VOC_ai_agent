package com.sellerops.agent.llm.report;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.report.ReportNarrative;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the report narrative model. Same mechanism as {@code AgentPlanService}: the org
 * check sits at the boundary, {@code AgentDraftBoundaryTest} asserts nothing else constructs the
 * generator, and the generator is built per call so a rotated key needs no restart.
 */
@Service
public class AgentReportNarrativeService {

    private static final Logger log = LoggerFactory.getLogger(AgentReportNarrativeService.class);

    private final AgentReportProperties properties;
    private final AgentLlmTransport transport;
    private final AgentCapabilityAccess access;

    public AgentReportNarrativeService(AgentReportProperties properties, AgentLlmTransport transport,
                                       AgentCapabilityAccess access) {
        this.properties = properties;
        this.transport = transport;
        this.access = access;
    }

    public boolean isEnabledFor(UUID orgId) {
        return access.allows(properties, orgId);
    }

    /** The provenance string a report records, or null when the capability is off for this org. */
    public String versionFor(UUID orgId) {
        return isEnabledFor(orgId) ? generator().version() : null;
    }

    /**
     * One narrative attempt, RAW — the caller validates. Empty when the org may not use the capability
     * or the call failed. The log line is metadata only: org, outcome, reason, cost.
     */
    public Optional<ReportNarrative> narrate(UUID orgId, String factsJson) {
        if (!isEnabledFor(orgId)) {
            return Optional.empty();
        }
        AgentReportNarrativeGenerator.Result result = generator().generate(factsJson);
        log.info("agent_report orgId={} narrated={} reason={} {}",
                orgId, result.narrative().isPresent(), result.reason(), result.metrics().toLogFields());
        return result.narrative();
    }

    private AgentReportNarrativeGenerator generator() {
        return new AgentReportNarrativeGenerator(transport, AgentLlmWireFormat.Vendor.of(properties.vendor()),
                properties.model(), properties.apiKey(), properties.maxOutputTokens(),
                properties.reasoningEffort());
    }
}
