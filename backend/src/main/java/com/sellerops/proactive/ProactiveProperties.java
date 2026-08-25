package com.sellerops.proactive;

import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The bounds of the proactive loop. Off by default; every value comes from the environment.
 *
 * <ul>
 *   <li>{@code SELLEROPS_PROACTIVE_ENABLED} — master switch for this package's scheduler.</li>
 *   <li>{@code SELLEROPS_PROACTIVE_ORG_IDS} — comma-separated org UUIDs this loop may act for.
 *       <b>Blank is fail closed.</b></li>
 *   <li><b>{@code SELLEROPS_PROACTIVE_DAILY_CAP}</b> — how many expensive preparations one org may
 *       get per DAY, inquiries and reviews together.</li>
 *   <li>{@code SELLEROPS_PROACTIVE_CANDIDATE_SCAN} — how many rows each lane's candidate read returns
 *       before the two are merged into one selection. A read bound, not a budget.</li>
 *   <li>{@code SELLEROPS_PROACTIVE_RECONCILE_PER_TICK} — how many open cases one tick re-derives.
 *       Reconcile calls no model, so this is a read bound and never a budget.</li>
 *   <li>{@code SELLEROPS_PROACTIVE_INTERVAL_MS} / {@code ..._INITIAL_DELAY_MS} — the cadence.</li>
 * </ul>
 *
 * <p><b>The cap is DAILY, not per tick</b> (product-owner correction, 2026-08-25). A per-tick cap
 * bounds a moment; what needs bounding is a day's spend, and ten ticks of three is thirty. It is also
 * a single cap across both kinds rather than one per lane: "three inquiries and five reviews" is not a
 * budget anyone decided, it is two numbers that happen to add up.
 *
 * <p><b>Why a cap exists at all.</b> An inquiry investigation spends the org's daily AI budget on the
 * same counter a seller-initiated draft does. Without one, a pass over a backlog would spend the whole
 * day before the seller opened a screen, and every draft they asked for afterwards would silently fall
 * back to the deterministic writer. The cap keeps the background loop from outbidding the person.
 * <b>There is no reserved slice for the loop</b> — it competes for the same quota on the same terms
 * and loses when the quota is gone (product-owner decision: proactive reserve = 0).
 *
 * <p><b>The bootstrap boundary is deliberately NOT here.</b> It was an env var for exactly one
 * bootstrap audit, and a boundary chosen for an audit is not a product contract. It now lives on the
 * org ({@code organizations.proactive_baseline_at}), written once when the loop first acts for it —
 * "when was this org activated" is a fact about the org, not about a deployment, and a value someone
 * can retype is a flood someone can re-open.
 *
 * <p><b>Which orgs it acts for is an INTERSECTION, and both halves are needed.</b> Self-Pilot Runtime
 * v1 answers the general question — may a background loop act for this org at all — and carries the
 * multi-tenant fence for it. This list answers a narrower one: which of those orgs may this particular
 * loop investigate. Collapsing them was a real hazard rather than a hypothetical: the local deployment
 * runs {@code LOCAL_SINGLE_USER}, which means "every org in this database" — 35 of them — and a
 * proactive loop inheriting that scope would have started preparing work for every one on the day it
 * was switched on. Blank means nobody.
 */
@Component
public class ProactiveProperties {

    private final boolean enabled;
    private final int dailyCap;
    private final int candidateScan;
    private final int reconcilePerTick;
    private final List<UUID> orgIds;

    @Autowired
    public ProactiveProperties(
            @Value("${sellerops.proactive.enabled:false}") boolean enabled,
            @Value("${sellerops.proactive.daily-cap:3}") int dailyCap,
            @Value("${sellerops.proactive.candidate-scan:50}") int candidateScan,
            @Value("${sellerops.proactive.reconcile-per-tick:50}") int reconcilePerTick,
            @Value("${sellerops.proactive.org-ids:}") String orgIds) {
        this(enabled, dailyCap, candidateScan, reconcilePerTick, parseOrgIds(orgIds));
    }

    /** Test/wiring constructor. */
    public ProactiveProperties(boolean enabled, int dailyCap, int candidateScan, int reconcilePerTick,
                               List<UUID> orgIds) {
        this.enabled = enabled;
        this.dailyCap = Math.max(0, dailyCap);
        this.candidateScan = Math.max(1, candidateScan);
        this.reconcilePerTick = Math.max(0, reconcilePerTick);
        this.orgIds = orgIds == null ? List.of() : List.copyOf(orgIds);
    }

    public boolean enabled() {
        return enabled;
    }

    /**
     * Expensive preparations one org may get per day — inquiries and reviews TOGETHER.
     *
     * <p>Counts every case the loop created today, including one whose investigation failed. An
     * attempt that reached the model and came back empty still spent the call; a cap that only counted
     * successes would be a cap on outcomes rather than on spend.
     */
    public int dailyCap() {
        return dailyCap;
    }

    /** How many rows each lane's candidate read returns before the merge. A read bound, not a budget. */
    public int candidateScan() {
        return candidateScan;
    }

    public int reconcilePerTick() {
        return reconcilePerTick;
    }

    /**
     * The orgs this loop may investigate. Empty means nobody — never "everybody".
     *
     * <p>A malformed UUID is dropped rather than failing startup: this is an optional, off-by-default
     * feature and a typo in its allow-list must not stop a backend that is serving inquiries. Dropping
     * narrows; it can never widen.
     */
    public List<UUID> orgIds() {
        return orgIds;
    }

    public boolean actsFor(UUID orgId) {
        return orgId != null && orgIds.contains(orgId);
    }

    private static List<UUID> parseOrgIds(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return Arrays.stream(raw.split(",")).map(String::strip).filter(part -> !part.isEmpty())
                .map(ProactiveProperties::parseUuid).filter(Objects::nonNull).toList();
    }

    private static UUID parseUuid(String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException malformed) {
            return null;
        }
    }
}
