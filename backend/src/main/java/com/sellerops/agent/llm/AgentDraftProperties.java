package com.sellerops.agent.llm;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The agent draft capability's switch — opt-in per organisation, off by default, in the shape
 * {@code AiTriagePilotProperties} established.
 *
 * <p><b>Deliberately a SEPARATE flag and a separate key from the triage pilot.</b> They are different
 * exposures: triage sends a review's rating and body; this sends an inquiry's title and body, which
 * is the content {@code DraftModelSeam}'s own docblock named as the reason a live model had not been
 * wired ("inquiry title/body is PII and must not egress until that decision"). That decision is now
 * made and it is THIS flag — a deployment that wants review triage and not draft generation, or the
 * reverse, must be able to have exactly that, and one shared flag would make the two indivisible.
 *
 * <p>The API key is read from configuration and held in memory only. It is never logged, never
 * stored, and never part of any version string.
 */
@Component
public class AgentDraftProperties {

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String vendor;
    private final String model;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;

    public AgentDraftProperties(
            @Value("${sellerops.agent.draft.enabled:false}") boolean enabled,
            @Value("${sellerops.agent.draft.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.agent.draft.vendor:OPENAI}") String vendor,
            @Value("${sellerops.agent.draft.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.agent.draft.api-key:}") String apiKey,
            @Value("${sellerops.agent.draft.max-output-tokens:4000}") int maxOutputTokens,
            @Value("${sellerops.agent.draft.reasoning-effort:low}") String reasoningEffort) {
        this.enabled = enabled;
        // "*" = every org in this backend — the local single-user deployment (Self-Pilot Runtime v1), where a
        // person who signed up in the browser must not need their org UUID copied into an env file. Any other
        // value stays the explicit allow-list (the multi-tenant-safe posture). Same rule as the triage pilot.
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.vendor = vendor;
        this.model = model;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens <= 0 ? 4000 : maxOutputTokens;
        this.reasoningEffort = reasoningEffort == null || reasoningEffort.isBlank() ? null : reasoningEffort;
    }

    private static List<UUID> parseIds(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).map(UUID::fromString).toList();
    }

    /** True only when the master switch is on AND a key is present AND the org is listed (or the list is {@code *}). */
    public boolean isEnabledFor(UUID orgId) {
        return enabled && apiKey != null && !apiKey.isBlank() && orgId != null
                && (allOrgs || enabledOrgIds.contains(orgId));
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
