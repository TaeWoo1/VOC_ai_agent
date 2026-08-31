package com.sellerops.agent.llm.operator;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.agent.plan.*} — the goal-interpretation capability's switch.
 *
 * <p>Off by default in three independent ways (flag, key, org list), like every LLM capability in this
 * repository. When it is off there is no deterministic sibling to take over: the run ends FAILED and
 * says so (Operator Graph v2 §12.1).
 *
 * <p><b>Two efforts, and which one is used is decided by EVIDENCE, not by the sentence.</b> Agent
 * Responsiveness v1 wanted "deep reasoning only for the hard ones", and the only honest way to know a
 * sentence is hard is to have tried: a first pass whose plan the validator refused, or a re-plan asked
 * for because the run's needs were not met, are the two moments the repository actually knows more
 * thinking is warranted. Both arrive here as a request carrying {@code priorContext}, and both get
 * {@link #retryReasoningEffort()}. Nothing classifies the seller's words to pick a tier — that would be
 * the keyword planner this capability exists instead of.
 */
@Component
public class AgentPlanProperties extends AgentOperatorProperties {

    private final String retryReasoningEffort;

    public AgentPlanProperties(
            @Value("${sellerops.agent.plan.enabled:false}") boolean enabled,
            @Value("${sellerops.agent.plan.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.agent.plan.vendor:OPENAI}") String vendor,
            @Value("${sellerops.agent.plan.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.agent.plan.api-key:}") String apiKey,
            // A v2 InvestigationPlan is much larger than v1's four fields, and on a reasoning model this
            // budget is shared with internal reasoning. Measured live 2026-08-21 at 2000: two of three
            // question classes returned budget_exhausted before emitting a plan.
            @Value("${sellerops.agent.plan.max-output-tokens:6000}") int maxOutputTokens,
            @Value("${sellerops.agent.plan.reasoning-effort:minimal}") String reasoningEffort,
            @Value("${sellerops.agent.plan.retry-reasoning-effort:low}") String retryReasoningEffort) {
        super(enabled, enabledOrgIds, vendor, model, apiKey, maxOutputTokens, reasoningEffort);
        this.retryReasoningEffort = retryReasoningEffort;
    }

    /**
     * The effort a SECOND attempt at the same goal is given.
     *
     * <p>Blank falls back to the first-pass effort, so a deployment can turn the escalation off without
     * a code change and without a value this class would have to invent.
     */
    public String retryReasoningEffort() {
        return retryReasoningEffort == null || retryReasoningEffort.isBlank()
                ? reasoningEffort()
                : retryReasoningEffort;
    }
}
