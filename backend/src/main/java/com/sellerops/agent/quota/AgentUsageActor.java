package com.sellerops.agent.quota;

/**
 * <b>Who spent the call — as opposed to whose org it was spent in.</b>
 *
 * Pilot QA, 2026-09-06. The daily budget is there so a SELLER's own use cannot run away. It counted
 * every call against the org, and a benchmark or a QA sitting signs in as a real account, so their
 * calls landed in that seller's meter: 1,211 runs against a limit of 200 on the demo org in one day.
 * Under the pilot default ({@code enforced=true}) that is a seller refused for the day by work they
 * never asked for.
 *
 * <p><b>Metering does not use this.</b> Every call is still recorded whatever the actor, because
 * usage, latency and cost are facts about the deployment's spend and a QA call costs exactly as much
 * as a seller's. Only the ENFORCEMENT comparison narrows to {@link #USER}.
 *
 * <p><b>USER is the default in every direction</b> — the column default, the missing-header case, and
 * the value used whenever the deployment has not opted in. A call this product cannot attribute is a
 * call it charges to the seller, because the alternative is a budget anyone can step around by
 * omitting a header.
 */
public enum AgentUsageActor {

    /** The seller, through the product. The only actor enforcement counts. */
    USER,

    /** A manual QA sitting driving the product against this org. Metered, never enforced against. */
    QA,

    /** A benchmark arm. Metered, never enforced against. */
    BENCHMARK;

    /** The header value a deployment may send, or USER for anything absent or unrecognised. */
    public static AgentUsageActor parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return USER;
        }
        try {
            return valueOf(raw.strip().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException unknown) {
            // An actor this build does not know is not a licence to skip the budget.
            return USER;
        }
    }

    /** Whether calls by this actor are compared against the daily limits. */
    public boolean enforced() {
        return this == USER;
    }
}
