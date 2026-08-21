package com.sellerops.agent.llm.operator;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the judge model — and the last gate on what may be judged.
 *
 * <p>Beyond the org allow-list this door carries a second check the draft and plan doors do not need:
 * {@link EvidenceDigestFloor#isSafe}. The judge's input is assembled by a caller from many sources, and
 * "assembled by a caller" is exactly how a customer sentence ends up somewhere it was never meant to
 * be. So a digest that looks like prose rather than metadata is REFUSED here — not truncated, not
 * masked — and the rule judge answers instead. Refusing costs a slightly quieter answer; not refusing
 * would cost a customer's words leaving the building through a door labelled "metadata only".
 */
@Service
public class AgentJudgeService {

    private static final Logger log = LoggerFactory.getLogger(AgentJudgeService.class);

    private final AgentJudgeProperties properties;
    private final AgentLlmTransport transport;

    public AgentJudgeService(AgentJudgeProperties properties, AgentLlmTransport transport) {
        this.properties = properties;
        this.transport = transport;
    }

    public boolean isEnabledFor(UUID orgId) {
        return properties.isEnabledFor(orgId);
    }

    public String versionFor(UUID orgId) {
        return properties.isEnabledFor(orgId) ? generator().version() : null;
    }

    /** Judge one finding against one evidence digest, or nothing. */
    public Optional<AgentOperatorResponseParser.ParsedVerdict> judge(UUID orgId, String finding,
                                                                     String evidenceDigest) {
        if (!properties.isEnabledFor(orgId)) {
            return Optional.empty();
        }
        if (!EvidenceDigestFloor.isSafe(evidenceDigest)) {
            // Counted and named, never quoted — the refused digest is the one thing that must not be logged.
            log.warn("agent_judge orgId={} judged=false reason=digest_floor_refused", orgId);
            return Optional.empty();
        }
        AgentJudgeGenerator.Result result =
                generator().generate(new AgentJudgeGenerator.Input(finding, evidenceDigest));
        log.info("agent_judge orgId={} judged={} reason={}", orgId, result.verdict().isPresent(),
                result.reason());
        return result.verdict();
    }

    private AgentJudgeGenerator generator() {
        return new AgentJudgeGenerator(transport, AgentLlmWireFormat.Vendor.of(properties.vendor()),
                properties.model(), properties.apiKey(), properties.maxOutputTokens(),
                properties.reasoningEffort());
    }
}
