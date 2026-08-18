package com.sellerops.selfpilot;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Self-Pilot Runtime v1 switch (product-owner decision 2026-08-18): the operator runs SellerOps on
 * their own seller accounts for days, and routine <b>READ</b> work — official-API collection on the
 * scheduler and bounded AI triage — runs without a per-run approval ceremony. Marketplace WRITE is
 * untouched by every knob here (see {@code CoupangLiveCallGuard#ensureLiveWriteAllowed}).
 *
 * <p>Off by default; every value comes from the environment (names only, never a secret):
 * <ul>
 *   <li>{@code SELLEROPS_SELF_PILOT_ENABLED} — master switch.</li>
 *   <li>{@code SELLEROPS_SELF_PILOT_ORG_IDS} — comma-separated org UUIDs the runtime acts for. Empty ⇒
 *       the reconciler acts for nobody (fail closed) even when enabled.</li>
 *   <li>{@code SELLEROPS_SELF_PILOT_READ_GRANT_ID} — the operator-minted <b>standing READ grant</b>
 *       ({@code spr-} + 8–32 hex). It arms READ-only marketplace calls (Coupang signed GETs) for the
 *       runtime's lifetime; it is an environment-binding token, never a credential, and every WRITE
 *       gate refuses it. Blank ⇒ Coupang reads still need the per-run live approval id.</li>
 *   <li>{@code SELLEROPS_SELF_PILOT_DEFAULT_INTERVAL_MINUTES} — cadence for the schedules the
 *       reconciler creates (floor 15, the schedule API's own minimum).</li>
 *   <li>{@code SELLEROPS_SELF_PILOT_TRIAGE_AUTO_ENABLED} / {@code SELLEROPS_SELF_PILOT_TRIAGE_PER_TICK} /
 *       {@code SELLEROPS_SELF_PILOT_TRIAGE_PER_DAY} — bounded automatic AI triage: per org at most
 *       {@code perTick} reviews per tick and {@code perDay} predictions per KST day. Requires the AI
 *       pilot itself ({@code sellerops.triage.ai-pilot.*}) to be enabled for the org.</li>
 * </ul>
 */
@Component
public class SelfPilotProperties {

    static final Pattern READ_GRANT_SHAPE = Pattern.compile("^spr-[0-9a-f]{8,32}$");
    static final int MIN_INTERVAL_MINUTES = 15;

    private final boolean enabled;
    private final List<UUID> orgIds;
    private final String readGrantId;
    private final int defaultIntervalMinutes;
    private final boolean triageAutoEnabled;
    private final int triagePerTick;
    private final int triagePerDay;

    public SelfPilotProperties(
            @Value("${sellerops.self-pilot.enabled:false}") boolean enabled,
            @Value("${sellerops.self-pilot.org-ids:}") String orgIds,
            @Value("${sellerops.self-pilot.read-grant-id:}") String readGrantId,
            @Value("${sellerops.self-pilot.default-interval-minutes:60}") int defaultIntervalMinutes,
            @Value("${sellerops.self-pilot.triage.auto-enabled:false}") boolean triageAutoEnabled,
            @Value("${sellerops.self-pilot.triage.per-tick:20}") int triagePerTick,
            @Value("${sellerops.self-pilot.triage.per-day:200}") int triagePerDay) {
        this.enabled = enabled;
        this.orgIds = parseIds(orgIds);
        String grant = readGrantId == null ? "" : readGrantId.trim();
        if (!grant.isEmpty() && !READ_GRANT_SHAPE.matcher(grant).matches()) {
            // A malformed grant is refused at boot — never accepted as "some non-blank string".
            throw new IllegalStateException(
                    "SELLEROPS_SELF_PILOT_READ_GRANT_ID must look like spr-<8..32 hex>; refusing to start.");
        }
        this.readGrantId = grant;
        this.defaultIntervalMinutes = Math.max(MIN_INTERVAL_MINUTES, defaultIntervalMinutes);
        this.triageAutoEnabled = triageAutoEnabled;
        this.triagePerTick = triagePerTick <= 0 ? 20 : Math.min(triagePerTick, 100);
        this.triagePerDay = triagePerDay <= 0 ? 200 : Math.min(triagePerDay, 2000);
    }

    private static List<UUID> parseIds(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .map(UUID::fromString).toList();
    }

    public boolean enabled() {
        return enabled;
    }

    /** True when the runtime acts for this org: master switch on AND the org is listed. */
    public boolean isEnabledFor(UUID orgId) {
        return enabled && orgId != null && orgIds.contains(orgId);
    }

    public List<UUID> orgIds() {
        return orgIds;
    }

    /** The standing READ grant, or {@code ""} when none is armed. */
    public String readGrantId() {
        return readGrantId;
    }

    public int defaultIntervalMinutes() {
        return defaultIntervalMinutes;
    }

    public boolean triageAutoEnabled() {
        return enabled && triageAutoEnabled;
    }

    public int triagePerTick() {
        return triagePerTick;
    }

    public int triagePerDay() {
        return triagePerDay;
    }
}
