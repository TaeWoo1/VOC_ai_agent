package com.sellerops.proactive;

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
 * </ul>
 *
 * <p><b>Which orgs it acts for is NOT decided here.</b> That question was already answered by
 * Self-Pilot Runtime v1 (product-owner decision 2026-08-18): routine automatic READ work runs for the
 * operator's own org under {@code SELLEROPS_SELF_PILOT_ORG_IDS} / {@code LOCAL_SINGLE_USER}, and that
 * scope carries its own multi-tenant fence (the loopback-database check). A second org list here
 * would be a second answer to a settled question, and the two would eventually disagree about whose
 * customers a background loop may read. Both switches must be on.
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

    public ProactiveProperties(
            @Value("${sellerops.proactive.enabled:false}") boolean enabled,
            @Value("${sellerops.proactive.inquiries-per-tick:3}") int inquiriesPerTick,
            @Value("${sellerops.proactive.reviews-per-tick:5}") int reviewsPerTick,
            @Value("${sellerops.proactive.reconcile-per-tick:50}") int reconcilePerTick) {
        this.enabled = enabled;
        this.inquiriesPerTick = Math.max(0, inquiriesPerTick);
        this.reviewsPerTick = Math.max(0, reviewsPerTick);
        this.reconcilePerTick = Math.max(0, reconcilePerTick);
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
