package com.sellerops.walkthrough;

/**
 * Sanitized identity of a disposable walkthrough runtime, returned by the read-only walkthrough context
 * endpoint so the frontend and the operator can PROVE the tab is talking to the exact bootstrapped
 * backend/DB/runtime — the binding that a green {@code /health} could not establish.
 *
 * <p><b>Channel-neutral.</b> The same run-id binding hosts a NAVER, Coupang WING, or any other channel's
 * guided walkthrough; the runtime only reports which channel it is bound to. {@code channelCode} is the
 * sanitized target channel (e.g. {@code NAVER}, {@code COUPANG}), {@code connectorEnabled} is that channel's
 * connector feature flag resolved for this bootstrap, and {@link Baseline#channelAccounts()} is the baseline
 * seller-account count for that same channel.
 *
 * <p><b>Sanitized by construction.</b> It carries a per-bootstrap opaque {@code walkthroughRunId} (an
 * environment identifier, never a credential or auth token), the git commit, the frontend/backend origins,
 * a DB <i>alias</i> (never the full JDBC URL / password), the scheduler + connector flags, coarse baseline
 * counts, and a start timestamp. It never exposes a DB URL, password, vault key, credential, token, or a
 * raw user/account identifier.
 */
public record WalkthroughContextView(
        String walkthroughRunId,
        String gitCommit,
        String frontendOrigin,
        String backendOrigin,
        String dbAlias,
        boolean schedulerEnabled,
        String channelCode,
        boolean connectorEnabled,
        Baseline baseline,
        String startedAt) {

    /** Coarse row counts for the disposable DB — a sanity/mismatch signal, not per-row data. */
    public record Baseline(long credentials, long syncJobs, long channelOrders, long channelAccounts) {
    }
}
