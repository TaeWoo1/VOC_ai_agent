package com.sellerops.agent.llm.goal;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the goal interpreter. The org check sits here, {@code AgentDraftBoundaryTest} asserts nothing
 * else constructs the generator, and the generator is built per call so a rotated key needs no restart.
 *
 * <p>The log line is metadata only: how long, how many tokens, which contract, and whether a set came back. The
 * customer's sentence and the goals are never logged.
 */
@Service
public class InquiryGoalService {

    private static final Logger log = LoggerFactory.getLogger(InquiryGoalService.class);

    private final InquiryGoalProperties properties;
    private final AgentLlmTransport transport;
    private final AgentCapabilityAccess access;

    public InquiryGoalService(InquiryGoalProperties properties, AgentLlmTransport transport,
                              AgentCapabilityAccess access) {
        this.properties = properties;
        this.transport = transport;
        this.access = access;
    }

    public boolean isEnabledFor(UUID orgId) {
        return access.allows(properties, orgId);
    }

    /** The contract any reading made now would be a reading of. */
    public String promptVersion() {
        return properties.promptVersion();
    }

    /** One interpretation attempt, RAW — the caller decides what to store and what to reuse. */
    public InquiryGoalGenerator.Result interpret(UUID orgId, String customerMessage) {
        InquiryGoalGenerator.Result result = generator().generate(customerMessage);
        log.info("inquiry_goal orgId={} interpreted={} reason={} model={} contract={} {}", orgId,
                result.parsed().isPresent() && !result.contractRefusal(), result.reason(), result.model(),
                properties.promptVersion(), result.metrics().toLogFields());
        return result;
    }

    private InquiryGoalGenerator generator() {
        return new InquiryGoalGenerator(transport, AgentLlmWireFormat.Vendor.of(properties.vendor()),
                properties.model(), properties.apiKey(), properties.maxOutputTokens(),
                properties.reasoningEffort());
    }
}
