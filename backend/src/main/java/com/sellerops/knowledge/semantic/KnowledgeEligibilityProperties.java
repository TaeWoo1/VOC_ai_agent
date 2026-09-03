package com.sellerops.knowledge.semantic;

import com.sellerops.agent.access.AgentCapabilityGate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The evidence-eligibility capability's switch — its own flag, its own key, off by default.
 * (Knowledge Retrieval Quality v2, 2026-09-03)
 *
 * <p><b>Why it is a capability of its own and not a second use of the intent key.</b> Its payload is
 * wider than either neighbour's, and that is the whole argument: the intent call sends one customer
 * sentence, the embedding call sends the seller's passages, and this one sends <b>both in the same
 * request</b> — the customer's words next to the seller's own text. A single flag over two different
 * exposures is a flag that cannot be reasoned about, so this is its own gate with its own key and its
 * own payload floor.
 *
 * <p>What it buys, measured on the v2 benchmark: wrong-source retrieval 2.2% → <b>0%</b> and
 * no-evidence precision 85.7% → <b>100%</b>, at no cost in recall it did not already owe (92.5% with
 * it, 93.5% without). It is the only arm measured that removed a class of error outright.
 */
@Component
public class KnowledgeEligibilityProperties implements AgentCapabilityGate {

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String model;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;

    public KnowledgeEligibilityProperties(
            @Value("${sellerops.knowledge.eligibility.enabled:false}") boolean enabled,
            @Value("${sellerops.knowledge.eligibility.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.knowledge.eligibility.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.knowledge.eligibility.api-key:}") String apiKey,
            @Value("${sellerops.knowledge.eligibility.max-output-tokens:600}") int maxOutputTokens,
            @Value("${sellerops.knowledge.eligibility.reasoning-effort:minimal}") String reasoningEffort) {
        this.enabled = enabled;
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.model = model;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens <= 0 ? 600 : maxOutputTokens;
        this.reasoningEffort = reasoningEffort == null || reasoningEffort.isBlank()
                ? null : reasoningEffort;
    }

    private static List<UUID> parseIds(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .map(UUID::fromString).toList();
    }

    @Override
    public String capabilityName() {
        return "SELLEROPS_KNOWLEDGE_ELIGIBILITY";
    }

    @Override
    public boolean isEnabled() {
        return enabled;
    }

    @Override
    public boolean isDeployed() {
        return enabled && apiKey != null && !apiKey.isBlank();
    }

    @Override
    public boolean namesAnyOrg() {
        return allOrgs || !enabledOrgIds.isEmpty();
    }

    @Override
    public boolean isConfiguredFor(UUID orgId) {
        return orgId != null && (allOrgs || enabledOrgIds.contains(orgId));
    }

    public String model() {
        return model;
    }

    public String apiKey() {
        return apiKey;
    }

    public int maxOutputTokens() {
        return maxOutputTokens;
    }

    public String reasoningEffort() {
        return reasoningEffort;
    }
}
