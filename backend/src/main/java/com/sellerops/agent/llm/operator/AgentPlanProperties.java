package com.sellerops.agent.llm.operator;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.agent.plan.*} — the goal-interpretation capability's switch.
 *
 * <p>Off by default in three independent ways (flag, key, org list), like every LLM capability in this
 * repository. When it is off, {@code parseGoal}'s deterministic keyword table answers instead and the
 * four demo goals still route — the planner widens what can be said, it is not load-bearing for what
 * already worked.
 */
@Component
public class AgentPlanProperties extends AgentOperatorProperties {

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
            @Value("${sellerops.agent.plan.reasoning-effort:low}") String reasoningEffort) {
        super(enabled, enabledOrgIds, vendor, model, apiKey, maxOutputTokens, reasoningEffort);
    }
}
