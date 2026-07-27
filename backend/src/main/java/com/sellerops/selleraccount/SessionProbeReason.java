package com.sellerops.selleraccount;

/**
 * Durable mirror of the pure kernel {@code contracts/session-readiness/v1} {@code ReadinessProbeReason} —
 * the four moments at which the runtime observes a session and reports its readiness.
 */
public enum SessionProbeReason {
    AGENT_START,
    BEFORE_WORK,
    SESSION_FAILURE,
    MANUAL_RECHECK;

    /** Parse a wire value, failing closed on anything unrecognized. */
    public static SessionProbeReason fromWire(String value) {
        if (value == null) {
            throw new IllegalArgumentException("probe reason is required");
        }
        for (SessionProbeReason r : values()) {
            if (r.name().equals(value)) {
                return r;
            }
        }
        throw new IllegalArgumentException("unknown probe reason");
    }
}
