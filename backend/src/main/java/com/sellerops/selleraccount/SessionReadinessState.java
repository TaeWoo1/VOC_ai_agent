package com.sellerops.selleraccount;

/**
 * Durable mirror of the pure kernel {@code contracts/session-readiness/v1} {@code SessionReadinessState}.
 *
 * <p>Whether a channel session is usable, and — when it is not — the single kind of thing the seller must
 * do. SellerOps performs none of those actions itself; the runtime only observes and reports. The names
 * match the contract exactly so the wire value the local-agent posts maps 1:1 without translation, and
 * {@link #UNOBSERVED_EXTERNAL} is the fail-closed default: a session that has never been observed is never
 * inferred READY.
 */
public enum SessionReadinessState {
    READY,
    LOGIN_REQUIRED,
    TWO_FACTOR_REQUIRED,
    ACCOUNT_AMBIGUOUS,
    EXPIRED,
    UNOBSERVED_EXTERNAL;

    /** Parse a wire value, failing closed on anything unrecognized rather than defaulting to a usable state. */
    public static SessionReadinessState fromWire(String value) {
        if (value == null) {
            throw new IllegalArgumentException("readiness state is required");
        }
        for (SessionReadinessState s : values()) {
            if (s.name().equals(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("unknown readiness state");
    }
}
