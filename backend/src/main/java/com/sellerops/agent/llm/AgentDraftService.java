package com.sellerops.agent.llm;

import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the draft model — the {@code ReviewTriageChannelGate} of this capability.
 *
 * <p>The org check sits at the boundary rather than in a caller's memory, and
 * {@code AgentDraftBoundaryTest} asserts that nothing else in {@code main} constructs an
 * {@link AgentDraftGenerator} or holds an {@link AgentLlmTransport}. That is the same mechanism the
 * triage package uses and it is protecting the same thing: a future service that held the generator
 * directly would be an allow-list nobody runs, and the seller's inquiry body would leave for an org
 * that never opted in.
 *
 * <p><b>Off is not an error.</b> A disabled deployment, an org outside the allow-list, and a missing
 * key all return {@link Optional#empty()}, and the caller renders the deterministic rule draft. The
 * capability degrading into the shipped behaviour is the design, not a fault to report.
 */
@Service
public class AgentDraftService {

    private static final Logger log = LoggerFactory.getLogger(AgentDraftService.class);

    private final AgentDraftProperties properties;
    private final AgentLlmTransport transport;

    public AgentDraftService(AgentDraftProperties properties, AgentLlmTransport transport) {
        this.properties = properties;
        this.transport = transport;
    }

    /** Whether this org may reach the model at all — the honest capability answer for a UI. */
    public boolean isEnabledFor(UUID orgId) {
        return properties.isEnabledFor(orgId);
    }

    /** The version string a run records, or null when the capability is off for this org. */
    public String versionFor(UUID orgId) {
        return properties.isEnabledFor(orgId) ? generator().version() : null;
    }

    /**
     * Generate a starter draft for one inquiry, or nothing.
     *
     * <p>The log line is coarse by construction: an org id, a boolean and a reason marker. The title,
     * the body, the generated draft, and any vendor text are never logged — this is the one method in
     * the backend that holds all of them at once.
     */
    public Optional<AgentDraftResponseParser.ParsedDraft> draft(UUID orgId, String title, String details) {
        if (!properties.isEnabledFor(orgId)) {
            return Optional.empty();
        }
        AgentDraftGenerator.Result result = generator().generate(new AgentDraftGenerator.Input(title, details));
        log.info("agent_draft orgId={} drafted={} reason={}", orgId, result.draft().isPresent(), result.reason());
        return result.draft();
    }

    /**
     * Built per call rather than held as a bean.
     *
     * <p>It costs nothing (the transport is the shared bean; this object is six fields) and it buys
     * the property that matters: a deployment that turns the capability on, changes a model, or
     * rotates a key does not need a restart to stop using the previous one, and no long-lived object
     * anywhere holds the API key beyond the life of a request.
     */
    private AgentDraftGenerator generator() {
        AgentDraftGenerator.Vendor vendor = "ANTHROPIC".equalsIgnoreCase(properties.vendor())
                ? AgentDraftGenerator.Vendor.ANTHROPIC
                : AgentDraftGenerator.Vendor.OPENAI;
        return new AgentDraftGenerator(transport, vendor, properties.model(), properties.apiKey(),
                properties.maxOutputTokens(), properties.reasoningEffort());
    }
}
