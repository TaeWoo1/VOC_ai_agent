package com.sellerops.agent.llm.operator;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the planner model.
 *
 * <p>The org check sits at the boundary rather than in a caller's memory, and
 * {@code AgentLlmBoundaryTest} asserts that nothing else in {@code main} constructs an
 * {@link AgentPlanGenerator} or holds an {@link AgentLlmTransport} it calls. That is the mechanism
 * {@code AgentDraftService} and {@code ReviewTriageChannelGate} already use, protecting the same
 * thing: a future service holding the generator directly would be an allow-list nobody runs.
 *
 * <p><b>Off is not an error here, but it IS terminal for the caller.</b> A disabled deployment, an org
 * outside the allow-list, and a missing key all return {@link Optional#empty()} — and since Operator
 * Graph v2 there is no deterministic router to fall back to, so the agent-runtime ends that run FAILED
 * and says why. This service still answers 200 with {@code available:false} rather than an error status:
 * "the capability is off for your org" is a normal answer, and the decision about what to do with it
 * belongs to the caller, not to an HTTP status.
 */
@Service
public class AgentPlanService {

    private static final Logger log = LoggerFactory.getLogger(AgentPlanService.class);

    private final AgentPlanProperties properties;
    private final AgentLlmTransport transport;

    public AgentPlanService(AgentPlanProperties properties, AgentLlmTransport transport) {
        this.properties = properties;
        this.transport = transport;
    }

    public boolean isEnabledFor(UUID orgId) {
        return properties.isEnabledFor(orgId);
    }

    /** The version string a run records, or null when the capability is off for this org. */
    public String versionFor(UUID orgId) {
        return properties.isEnabledFor(orgId) ? generator().version() : null;
    }

    /**
     * Interpret one goal against one tool catalogue, or nothing.
     *
     * <p>The log line is an org id, a boolean and a reason marker. The goal sentence is NOT logged: it
     * is the operator's own text, but it is text, and a log line is the easiest place for text to
     * outlive the decision to send it.
     */
    public Optional<AgentOperatorResponseParser.ParsedPlan> plan(UUID orgId, String goalText,
                                                                 List<String> toolCatalogue) {
        return plan(orgId, goalText, toolCatalogue, null);
    }

    /**
     * As above, with a re-plan progress line.
     *
     * <p>{@code priorContext} is need ids and statuses in closed vocabulary — never an evidence value,
     * a count, or a customer word. It exists because a re-plan that cannot see its own earlier reasoning
     * re-derives it, and re-derivation under a different sample is how a bounded loop starts oscillating.
     */
    public Optional<AgentOperatorResponseParser.ParsedPlan> plan(UUID orgId, String goalText,
                                                                 List<String> toolCatalogue,
                                                                 String priorContext) {
        return plan(orgId, goalText, toolCatalogue, priorContext, false);
    }

    /**
     * As above, told whether this is a second attempt at the same goal.
     *
     * <p>{@code retry} is the caller's assertion, not an inference from {@code priorContext}: that
     * field also carries the conversation's working-set line on ordinary follow-up sentences, and
     * treating its presence as difficulty made every second sentence in a conversation pay for deep
     * reasoning. See {@code AgentOperatorController.PlanRequest#isRetry}.
     */
    public Optional<AgentOperatorResponseParser.ParsedPlan> plan(UUID orgId, String goalText,
                                                                 List<String> toolCatalogue,
                                                                 String priorContext, boolean retry) {
        if (!properties.isEnabledFor(orgId)) {
            return Optional.empty();
        }
        AgentPlanGenerator.Result result = generator(retry)
                .generate(new AgentPlanGenerator.Input(goalText, toolCatalogue, priorContext));
        // The cost of the call rides on the same line as its outcome: a planned=true that took 30
        // seconds and a planned=true that took 3 are the same event to every reader that cannot see
        // both. Metadata only — a duration and the vendor's own token counts, never the sentence.
        log.info("agent_plan orgId={} planned={} reason={} {}",
                orgId, result.plan().isPresent(), result.reason(), result.metrics().toLogFields());
        return result.plan();
    }

    /**
     * Built per call rather than held as a bean, for {@code AgentDraftService}'s reason: it costs
     * nothing, and a deployment that rotates a key or changes a model does not need a restart to stop
     * using the previous one. No long-lived object holds the API key beyond one request.
     */
    private AgentPlanGenerator generator() {
        return generator(false);
    }

    private AgentPlanGenerator generator(boolean retry) {
        return new AgentPlanGenerator(transport, AgentLlmWireFormat.Vendor.of(properties.vendor()),
                properties.model(), properties.apiKey(), properties.maxOutputTokens(),
                retry ? properties.retryReasoningEffort() : properties.reasoningEffort());
    }
}
