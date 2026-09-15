package com.sellerops.operationscase.investigation;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the case investigation model. Same mechanism as every capability: the org check sits here,
 * {@code AgentDraftBoundaryTest} asserts nothing else constructs the generator, and the generator is built per call
 * so a rotated key needs no restart. The log line is metadata only.
 */
@Service
public class CaseInvestigationService {

    private static final Logger log = LoggerFactory.getLogger(CaseInvestigationService.class);

    private final CaseInvestigationProperties properties;
    private final AgentLlmTransport transport;
    private final AgentCapabilityAccess access;

    public CaseInvestigationService(CaseInvestigationProperties properties, AgentLlmTransport transport,
                                    AgentCapabilityAccess access) {
        this.properties = properties;
        this.transport = transport;
        this.access = access;
    }

    public boolean isEnabledFor(UUID orgId) {
        return access.allows(properties, orgId);
    }

    public int maxPerRun() {
        return properties.maxPerRun();
    }

    /** One investigation attempt, RAW — the caller validates refs and applies the guard. */
    public CaseInvestigationGenerator.Result investigate(UUID orgId, String context) {
        CaseInvestigationGenerator generator = generator();
        CaseInvestigationGenerator.Result result = generator.generate(context);
        log.info("responsibility_investigation orgId={} concluded={} reason={} model={} {}",
                orgId, result.output().isPresent(), result.reason(), result.model(), result.metrics().toLogFields());
        return result;
    }

    private CaseInvestigationGenerator generator() {
        return new CaseInvestigationGenerator(transport, AgentLlmWireFormat.Vendor.of(properties.vendor()),
                properties.model(), properties.apiKey(), properties.maxOutputTokens(), properties.reasoningEffort());
    }
}
