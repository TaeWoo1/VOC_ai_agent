package com.sellerops.proactive;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The bounds of the proactive loop. Off by default; every value comes from the environment.
 *
 * <ul>
 *   <li>{@code SELLEROPS_PROACTIVE_ENABLED} — master switch for this package's scheduler.</li>
 *   <li>{@code SELLEROPS_PROACTIVE_INQUIRIES_PER_TICK} / {@code ..._REVIEWS_PER_TICK} — how many
 *       NEW investigations one tick may start, per org, per kind.</li>
 *   <li>{@code SELLEROPS_PROACTIVE_RECONCILE_PER_TICK} — how many open cases one tick re-derives.</li>
 *   <li>{@code SELLEROPS_PROACTIVE_INTERVAL_MS} / {@code ..._INITIAL_DELAY_MS} — the cadence.</li>
 *   <li><b>{@code SELLEROPS_PROACTIVE_ORG_IDS}</b> — comma-separated org UUIDs this loop may act for.
 *       <b>Blank is fail closed.</b></li>
 *   <li><b>{@code SELLEROPS_PROACTIVE_OBSERVED_SINCE}</b> — the bootstrap boundary, an ISO-8601 instant.
 *       Only work SellerOps FIRST OBSERVED at or after it may be investigated. <b>Blank is fail closed:
 *       no boundary, no candidates, ever.</b></li>
 * </ul>
 *
 * <p><b>Why the boundary is required rather than defaulted.</b> Every plausible default is wrong in a
 * way nobody would notice until it had already happened. "Beginning of time" pours an org's entire
 * imported history onto the screen on the day the switch is flipped — measured on the canonical Demo
 * Org, that was 22 inquiries whose newest was 18 months old and whose oldest was from 2014, plus 16
 * reviews with none from the last 30 days. "Process start" silently re-opens the same flood on every
 * restart. "Now, remembered somewhere" is the watermark subsystem this deliberately does not build.
 * A required value makes the question — <i>from when is this org's work SellerOps' business?</i> —
 * something a person answers once, out loud, in configuration.
 *
 * <p><b>Which orgs it acts for is an INTERSECTION, and both halves are needed.</b> Self-Pilot Runtime
 * v1 answers the general question — may a background loop act for this org at all — and carries the
 * multi-tenant fence for it (the loopback-database check behind {@code LOCAL_SINGLE_USER}). This list
 * answers a narrower one: which of those orgs may this particular loop investigate. They are not the
 * same question, and collapsing them was a real hazard rather than a hypothetical: the local
 * deployment runs {@code LOCAL_SINGLE_USER}, which means "every org in this database" — 35 of them —
 * and a proactive loop inheriting that scope would have started preparing work for every one on the
 * day it was switched on. Blank means nobody.
 *
 * <p><b>Why the per-tick caps exist at all.</b> An inquiry investigation spends the org's daily AI
 * budget on the same counter a seller-initiated draft does. Without a cap, one tick over a 25-item
 * backlog would spend the whole day's budget before the seller opened the screen, and every draft
 * they asked for afterwards would silently fall back to the deterministic writer. The cap is what
 * keeps the background loop from outbidding the person.
 */
@Component
public class ProactiveProperties {

    private final boolean enabled;
    private final int inquiriesPerTick;
    private final int reviewsPerTick;
    private final int reconcilePerTick;
    private final Instant observedSince;
    private final List<UUID> orgIds;

    @Autowired
    public ProactiveProperties(
            @Value("${sellerops.proactive.enabled:false}") boolean enabled,
            @Value("${sellerops.proactive.inquiries-per-tick:3}") int inquiriesPerTick,
            @Value("${sellerops.proactive.reviews-per-tick:5}") int reviewsPerTick,
            @Value("${sellerops.proactive.reconcile-per-tick:50}") int reconcilePerTick,
            @Value("${sellerops.proactive.observed-since:}") String observedSince,
            @Value("${sellerops.proactive.org-ids:}") String orgIds) {
        this.enabled = enabled;
        this.inquiriesPerTick = Math.max(0, inquiriesPerTick);
        this.reviewsPerTick = Math.max(0, reviewsPerTick);
        this.reconcilePerTick = Math.max(0, reconcilePerTick);
        this.observedSince = parseBoundary(observedSince);
        this.orgIds = parseOrgIds(orgIds);
    }

    /** Test/wiring constructor for callers that do not go through the environment. */
    public ProactiveProperties(boolean enabled, int inquiriesPerTick, int reviewsPerTick,
                               int reconcilePerTick, Instant observedSince) {
        this(enabled, inquiriesPerTick, reviewsPerTick, reconcilePerTick, observedSince, List.of());
    }

    /** Test/wiring constructor that also states the org allow-list. */
    public ProactiveProperties(boolean enabled, int inquiriesPerTick, int reviewsPerTick,
                               int reconcilePerTick, Instant observedSince, List<UUID> orgIds) {
        this.enabled = enabled;
        this.inquiriesPerTick = Math.max(0, inquiriesPerTick);
        this.reviewsPerTick = Math.max(0, reviewsPerTick);
        this.reconcilePerTick = Math.max(0, reconcilePerTick);
        this.observedSince = observedSince;
        this.orgIds = orgIds == null ? List.of() : List.copyOf(orgIds);
    }

    /**
     * The orgs this loop may investigate. Empty means nobody — never "everybody".
     *
     * <p>A malformed UUID is dropped rather than failing startup, for the reason the boundary parser
     * gives: this is an optional, off-by-default feature and a typo in its allow-list must not stop a
     * backend that is serving inquiries. Dropping narrows; it can never widen.
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
                .map(ProactiveProperties::parseUuid).filter(java.util.Objects::nonNull).toList();
    }

    private static UUID parseUuid(String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException malformed) {
            return null;
        }
    }

    /**
     * The boundary, or empty.
     *
     * <p>A malformed value is treated as absent rather than as a startup failure, and the choice is
     * deliberate: this is an optional feature that is off by default, and a typo in its boundary must
     * not stop a backend that is serving a seller's inquiries. Absent means nothing is prepared, which
     * is the same thing the typo's author would have wanted over a flood.
     */
    private static Instant parseBoundary(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(raw.strip());
        } catch (DateTimeParseException malformed) {
            return null;
        }
    }

    /**
     * From when this org's work is SellerOps' business — empty when unset, and empty means
     * <b>no candidate is ever selected</b>.
     */
    public Optional<Instant> observedSince() {
        return Optional.ofNullable(observedSince);
    }

    public boolean enabled() {
        return enabled;
    }

    public int inquiriesPerTick() {
        return inquiriesPerTick;
    }

    public int reviewsPerTick() {
        return reviewsPerTick;
    }

    public int reconcilePerTick() {
        return reconcilePerTick;
    }
}
