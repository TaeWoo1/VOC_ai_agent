package com.sellerops.agent.llm.operator;

import com.sellerops.agent.access.AgentCapabilityGate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * One capability's switch: off by default, keyed, and opt-in per organisation.
 *
 * <p>Shared SHAPE, never a shared FLAG. {@code AgentDraftProperties} spells out why the draft
 * capability could not ride on the triage pilot's flag — they are different exposures and a deployment
 * must be able to run either without the other — and the same argument produces two more flags here:
 *
 * <ul>
 *   <li>{@code sellerops.agent.plan.*} sends the operator's own sentence and a static tool catalogue;</li>
 *   <li>{@code sellerops.agent.judge.*} sends a SellerOps-authored sentence and closed-vocabulary
 *       evidence metadata.</li>
 * </ul>
 *
 * <p>Neither sends a customer utterance, and neither may be turned on by turning on the other. This
 * class is the common shape so that the three-way "off by default" property is written once and
 * asserted once; the two {@code @Component} subclasses below it carry the actual property keys.
 *
 * <p>The API key is held in memory only. Never logged, never stored, never part of a version string.
 */
public abstract class AgentOperatorProperties implements AgentCapabilityGate {

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String vendor;
    private final String model;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;

    protected AgentOperatorProperties(boolean enabled, String enabledOrgIds, String vendor, String model,
                                      String apiKey, int maxOutputTokens, String reasoningEffort) {
        this.enabled = enabled;
        // "*" = every org in this backend — the local single-user deployment, where a person who signed
        // up in the browser must not need their org UUID copied into an env file. Same rule as the
        // draft capability and the triage pilot; any other value stays an explicit allow-list.
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.vendor = vendor;
        this.model = model;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens <= 0 ? 2000 : maxOutputTokens;
        this.reasoningEffort = reasoningEffort == null || reasoningEffort.isBlank() ? null : reasoningEffort;
    }

    private static List<UUID> parseIds(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .map(UUID::fromString).toList();
    }

    @Override
    public boolean isEnabled() {
        return enabled;
    }

    @Override
    public boolean namesAnyOrg() {
        return allOrgs || !enabledOrgIds.isEmpty();
    }

    /** Deployment-level: the flag is on and a key is present. No organisation policy widens this. */
    @Override
    public boolean isDeployed() {
        return enabled && apiKey != null && !apiKey.isBlank();
    }

    /** Organisation-level, from configuration alone: the {@code *} wildcard or the explicit list. */
    @Override
    public boolean isConfiguredFor(UUID orgId) {
        return orgId != null && (allOrgs || enabledOrgIds.contains(orgId));
    }

    public String vendor() {
        return vendor;
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
