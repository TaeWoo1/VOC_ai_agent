package com.sellerops.agent.llm.converse;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the conversation model — and the last gate on what may be said to it.
 *
 * <p>Beyond the org policy this door carries {@link ConverseRequestFloor}, for the reason the judge's
 * door carries {@code EvidenceDigestFloor}: this capability's input is assembled by a caller holding a
 * whole turn's state, and "assembled by a caller" is exactly how a customer's sentence ends up
 * somewhere it was never meant to be. A request that fails the floor is REFUSED here — not truncated,
 * not masked — and the deterministic composer answers instead.
 *
 * <p>It reads nothing and writes nothing: no work item is looked up, no state moves, nothing is stored.
 */
@Service
public class AgentConverseService {

    private static final Logger log = LoggerFactory.getLogger(AgentConverseService.class);

    private final AgentConverseProperties properties;
    private final AgentLlmTransport transport;
    private final AgentCapabilityAccess access;

    public AgentConverseService(AgentConverseProperties properties, AgentLlmTransport transport,
                                AgentCapabilityAccess access) {
        this.properties = properties;
        this.transport = transport;
        this.access = access;
    }

    public String versionFor(UUID orgId) {
        return access.allows(properties, orgId) ? generator().version() : null;
    }

    /** Answer one conversational turn from the facts given, or nothing. */
    public Optional<String> converse(UUID orgId, String question, List<String> facts,
                                     List<String> context, List<String> recentTurns) {
        if (!access.allows(properties, orgId)) {
            return Optional.empty();
        }
        if (!ConverseRequestFloor.isSafe(question, facts, context, recentTurns)) {
            // Counted and named, never quoted — the refused payload is the one thing that must not be logged.
            log.warn("agent_converse orgId={} answered=false reason=request_floor_refused", orgId);
            return Optional.empty();
        }
        AgentConverseGenerator.Result result = generator().generate(
                new AgentConverseGenerator.Input(facts, context, recentTurns, question));
        // Metadata only — never the question, never the answer, never a fact line.
        log.info("agent_converse orgId={} answered={} reason={} facts={} turns={} ms={} promptTokens={} "
                        + "completionTokens={} reasoningTokens={}", orgId,
                result.answer().isPresent(), result.reason(), facts.size(), recentTurns.size(),
                result.metrics().elapsedMs(), result.metrics().promptTokens(),
                result.metrics().completionTokens(), result.metrics().reasoningTokens());
        return result.answer().map(AgentConverseGenerator.Answer::text);
    }

    private AgentConverseGenerator generator() {
        return new AgentConverseGenerator(transport, AgentLlmWireFormat.Vendor.of(properties.vendor()),
                properties.model(), properties.apiKey(), properties.maxOutputTokens(),
                properties.reasoningEffort());
    }
}
