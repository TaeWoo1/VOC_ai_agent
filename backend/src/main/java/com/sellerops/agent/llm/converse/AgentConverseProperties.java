package com.sellerops.agent.llm.converse;

import com.sellerops.agent.llm.operator.AgentOperatorProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.agent.converse.*} — the Grounded Conversation lane's switch.
 *
 * <p><b>Why a tenth capability and not a reuse of the planner's.</b> The planner receives the seller's
 * sentence and a static tool catalogue and returns closed tokens. This one receives the seller's
 * sentence, the sentences <i>we</i> wrote earlier in the same thread, and a fact sheet this deployment
 * assembled about itself — and it returns PROSE a seller reads. Same class of content, a wider shape
 * and a different failure mode, so it gets its own flag, key, prompt, parser and byte-asserted floor,
 * exactly as {@code AgentOperatorProperties} argues for plan and judge.
 *
 * <p><b>Off by default, and a failure is silence.</b> When this capability is off — or the model is
 * unreachable, or its answer fails the runtime's guard — the deterministic composer answers, which is
 * byte-for-byte what shipped before this package. So the direction of every failure is «the older,
 * narrower answer», never «no answer».
 *
 * <p>It admits the deployment's access policy for the same reason the planner does: what leaves is the
 * seller's own sentence, which is what a seller typing into the chat box is asking us to read.
 */
@Component
public class AgentConverseProperties extends AgentOperatorProperties {

    public AgentConverseProperties(
            @Value("${sellerops.agent.converse.enabled:false}") boolean enabled,
            @Value("${sellerops.agent.converse.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.agent.converse.vendor:OPENAI}") String vendor,
            @Value("${sellerops.agent.converse.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.agent.converse.api-key:}") String apiKey,
            @Value("${sellerops.agent.converse.max-output-tokens:2000}") int maxOutputTokens,
            @Value("${sellerops.agent.converse.reasoning-effort:minimal}") String reasoningEffort) {
        super(enabled, enabledOrgIds, vendor, model, apiKey, maxOutputTokens, reasoningEffort);
    }

    @Override
    public String capabilityName() {
        return "SELLEROPS_AGENT_CONVERSE";
    }
}
