package com.sellerops.review.triage.pilot;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The conservative production pilot's switch, RUBRIC v2 §13.7 item 6: opt-in per organisation and
 * off by default.
 *
 * <p>Every request knob is here rather than inferred, because all of them are part of the
 * classifier's identity (§8.8) — a pilot whose model or effort came from a default somewhere else
 * would be running a candidate nobody had named. The defaults are the frozen candidate C2's;
 * changing any of them is running a different candidate and must say so in the change log.
 *
 * <p>The API key is read from configuration and held in memory only. It is never logged, never
 * stored, and never part of any version string. Bound with {@code @Value} like
 * {@code CredentialHandoffArming}, the house style for environment-fed configuration.
 */
@Component
public class AiTriagePilotProperties {

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String vendor;
    private final String model;
    private final String apiKey;
    private final boolean omitTemperature;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final int maxPerRun;

    public AiTriagePilotProperties(
            @Value("${sellerops.triage.ai-pilot.enabled:false}") boolean enabled,
            @Value("${sellerops.triage.ai-pilot.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.triage.ai-pilot.vendor:OPENAI}") String vendor,
            @Value("${sellerops.triage.ai-pilot.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.triage.ai-pilot.api-key:}") String apiKey,
            @Value("${sellerops.triage.ai-pilot.omit-temperature:true}") boolean omitTemperature,
            @Value("${sellerops.triage.ai-pilot.max-output-tokens:4000}") int maxOutputTokens,
            @Value("${sellerops.triage.ai-pilot.reasoning-effort:low}") String reasoningEffort,
            @Value("${sellerops.triage.ai-pilot.max-per-run:100}") int maxPerRun) {
        this.enabled = enabled;
        // "*" = every org in this backend — the local single-user deployment (Self-Pilot Runtime v1), where a
        // person who signed up in the browser must not need their org UUID copied into an env file. Any other
        // value stays the explicit allow-list (the multi-tenant-safe posture).
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.vendor = vendor;
        this.model = model;
        this.apiKey = apiKey;
        this.omitTemperature = omitTemperature;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort == null || reasoningEffort.isBlank() ? null : reasoningEffort;
        this.maxPerRun = maxPerRun <= 0 ? 100 : Math.min(maxPerRun, 500);
    }

    private static List<UUID> parseIds(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).map(UUID::fromString).toList();
    }

    /** True only when the master switch is on AND the org is listed (or the list is {@code *}) AND a key is present. */
    public boolean isEnabledFor(UUID orgId) {
        return enabled && apiKey != null && !apiKey.isBlank() && orgId != null
                && (allOrgs || enabledOrgIds.contains(orgId));
    }

    public boolean enabled() {
        return enabled && apiKey != null && !apiKey.isBlank();
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

    public boolean omitTemperature() {
        return omitTemperature;
    }

    public int maxOutputTokens() {
        return maxOutputTokens;
    }

    public String reasoningEffort() {
        return reasoningEffort;
    }

    /** How many reviews one run may classify. A bounded run is a run someone can reason about. */
    public int maxPerRun() {
        return maxPerRun;
    }
}
