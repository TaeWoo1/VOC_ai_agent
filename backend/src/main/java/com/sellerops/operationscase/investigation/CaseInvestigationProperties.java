package com.sellerops.operationscase.investigation;

import com.sellerops.agent.llm.operator.AgentOperatorProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.responsibility.investigation.*} — the case investigator's switch (Responsibility Runtime v1,
 * Package B). The eleventh LLM capability, with its own flag, key, org list, prompt and payload floor.
 *
 * <p><b>What leaves.</b> One customer inquiry or review — REDACTED by the same {@code VocPreviewSanitizer} every
 * other body surface uses, and bounded — plus closed facts and short excerpts of the seller's own knowledge that
 * Reviewnary read for it. No identifier of any kind; evidence is named by local refs ({@code subject}, {@code k1}).
 *
 * <p><b>Why it never widens.</b> Like the three retrieval capabilities, its payload is customer text sent while
 * nobody is looking. A seller does not ask for that by connecting a channel, and does not ask for it by accepting
 * 「고객 운영 관리」 either — the organisation is named here AND in {@code RESPONSIBILITY_RUNTIME_ORG_IDS}, or no
 * model is called. Off by default three ways, like every capability.
 */
@Component
public class CaseInvestigationProperties extends AgentOperatorProperties {

    private final int maxPerRun;

    public CaseInvestigationProperties(
            @Value("${sellerops.responsibility.investigation.enabled:false}") boolean enabled,
            @Value("${sellerops.responsibility.investigation.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.responsibility.investigation.vendor:OPENAI}") String vendor,
            @Value("${sellerops.responsibility.investigation.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.responsibility.investigation.api-key:}") String apiKey,
            @Value("${sellerops.responsibility.investigation.max-output-tokens:2500}") int maxOutputTokens,
            @Value("${sellerops.responsibility.investigation.reasoning-effort:low}") String reasoningEffort,
            @Value("${sellerops.responsibility.investigation.max-per-run:5}") int maxPerRun) {
        super(enabled, enabledOrgIds, vendor, model, apiKey, maxOutputTokens, reasoningEffort);
        this.maxPerRun = Math.max(0, maxPerRun);
    }

    @Override
    public String capabilityName() {
        return "SELLEROPS_RESPONSIBILITY_INVESTIGATION";
    }

    @Override
    public boolean admitsPolicyWidening() {
        return false;
    }

    /** At most this many investigations per run; the rest stay candidates for the next run. */
    public int maxPerRun() {
        return maxPerRun;
    }
}
