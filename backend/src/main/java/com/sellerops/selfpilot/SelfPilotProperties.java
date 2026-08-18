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

    /**
     * Which organisations the runtime acts for.
     *
     * <ul>
     *   <li>{@code ALLOW_LIST} (default) — only the UUIDs in {@code SELLEROPS_SELF_PILOT_ORG_IDS}. The
     *       multi-tenant-safe posture: an org is never picked up unless the deployer named it.</li>
     *   <li>{@code LOCAL_SINGLE_USER} — <b>every</b> org in this backend's own database. The one-seller local
     *       deployment (product-owner decision 2026-08-18): a person who signs up in the browser must not
     *       need anyone to copy an org UUID into an env file before routine collection starts. Fenced to a
     *       loopback database ({@code SPRING_DATASOURCE_URL} host localhost / 127.0.0.1 / ::1) — on any other
     *       host the backend refuses to start with this scope, so it can never be switched on against a
     *       shared database by accident.</li>
     * </ul>
     */
    public enum Scope { ALLOW_LIST, LOCAL_SINGLE_USER }

    private final boolean enabled;
    private final Scope scope;
    private final List<UUID> orgIds;
    private final String readGrantId;
    private final int defaultIntervalMinutes;
    private final boolean triageAutoEnabled;
    private final int triagePerTick;
    private final int triagePerDay;

    public SelfPilotProperties(
            @Value("${sellerops.self-pilot.enabled:false}") boolean enabled,
            @Value("${sellerops.self-pilot.scope:ALLOW_LIST}") String scope,
            @Value("${sellerops.self-pilot.org-ids:}") String orgIds,
            @Value("${sellerops.self-pilot.read-grant-id:}") String readGrantId,
            @Value("${sellerops.self-pilot.default-interval-minutes:60}") int defaultIntervalMinutes,
            @Value("${sellerops.self-pilot.triage.auto-enabled:false}") boolean triageAutoEnabled,
            @Value("${sellerops.self-pilot.triage.per-tick:20}") int triagePerTick,
            @Value("${sellerops.self-pilot.triage.per-day:200}") int triagePerDay,
            @Value("${spring.datasource.url:}") String datasourceUrl) {
        this.enabled = enabled;
        this.scope = parseScope(scope);
        if (enabled && this.scope == Scope.LOCAL_SINGLE_USER && !isLoopbackDatabase(datasourceUrl)) {
            throw new IllegalStateException(
                    "SELLEROPS_SELF_PILOT_SCOPE=LOCAL_SINGLE_USER is allowed only against a loopback database "
                    + "(SPRING_DATASOURCE_URL host localhost/127.0.0.1); refusing to start.");
        }
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

    private static Scope parseScope(String raw) {
        if (raw == null || raw.isBlank()) {
            return Scope.ALLOW_LIST;
        }
        try {
            return Scope.valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(
                    "SELLEROPS_SELF_PILOT_SCOPE must be ALLOW_LIST or LOCAL_SINGLE_USER; refusing to start.");
        }
    }

    /** True for a JDBC URL whose host is the local loopback (the only place LOCAL_SINGLE_USER may run). */
    static boolean isLoopbackDatabase(String jdbcUrl) {
        if (jdbcUrl == null || jdbcUrl.isBlank()) {
            return false;
        }
        String url = jdbcUrl.trim();
        // jdbc:postgresql://host[:port]/db  |  jdbc:h2:mem:... (in-memory: local by construction)
        if (url.startsWith("jdbc:h2:mem:") || url.startsWith("jdbc:h2:file:")) {
            return true;
        }
        int schemeEnd = url.indexOf("://");
        if (schemeEnd < 0) {
            return false;
        }
        String rest = url.substring(schemeEnd + 3);
        int slash = rest.indexOf('/');
        String hostPort = slash < 0 ? rest : rest.substring(0, slash);
        String host = hostPort.startsWith("[") ? hostPort.substring(1, Math.max(1, hostPort.indexOf(']')))
                : (hostPort.contains(":") ? hostPort.substring(0, hostPort.indexOf(':')) : hostPort);
        host = host.toLowerCase(java.util.Locale.ROOT);
        return host.equals("localhost") || host.equals("127.0.0.1") || host.equals("::1");
    }

    public boolean enabled() {
        return enabled;
    }

    public Scope scope() {
        return scope;
    }

    /**
     * True when the runtime acts for this org: master switch on AND (LOCAL_SINGLE_USER, or the org is on
     * the allow-list).
     */
    public boolean isEnabledFor(UUID orgId) {
        if (!enabled || orgId == null) {
            return false;
        }
        return scope == Scope.LOCAL_SINGLE_USER || orgIds.contains(orgId);
    }

    /** True when the runtime acts for every org in this database (LOCAL_SINGLE_USER). */
    public boolean actsForAllOrgs() {
        return enabled && scope == Scope.LOCAL_SINGLE_USER;
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
