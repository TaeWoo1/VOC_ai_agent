package com.sellerops.agent.llm.operator;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.agent.judge.*} — the Evidence Judge's switch.
 *
 * <p>Off by default in three independent ways. When it is off the deterministic rule judge answers,
 * and the rule judge is the CONSERVATIVE one: it can withhold a finding but it never approves a claim
 * the LLM judge would have refused on grounds the rules do not model. So turning this capability off
 * makes the Operator quieter, never bolder — the direction a failure must fall.
 */
@Component
public class AgentJudgeProperties extends AgentOperatorProperties {

    public AgentJudgeProperties(
            @Value("${sellerops.agent.judge.enabled:false}") boolean enabled,
            @Value("${sellerops.agent.judge.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.agent.judge.vendor:OPENAI}") String vendor,
            @Value("${sellerops.agent.judge.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.agent.judge.api-key:}") String apiKey,
            @Value("${sellerops.agent.judge.max-output-tokens:2000}") int maxOutputTokens,
            @Value("${sellerops.agent.judge.reasoning-effort:low}") String reasoningEffort) {
        super(enabled, enabledOrgIds, vendor, model, apiKey, maxOutputTokens, reasoningEffort);
    }

    @Override
    public String capabilityName() {
        return "SELLEROPS_AGENT_JUDGE";
    }
}
