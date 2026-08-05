package com.sellerops.walkthrough;

/**
 * Sanitized identity of a disposable walkthrough runtime, returned by the read-only walkthrough context
 * endpoint so the frontend and the operator can PROVE the tab is talking to the exact bootstrapped
 * backend/DB/runtime — the binding that a green {@code /health} could not establish.
 *
 * <p><b>Sanitized by construction.</b> It carries a per-bootstrap opaque {@code walkthroughRunId} (an
 * environment identifier, never a credential or auth token), the git commit, the frontend/backend origins,
 * a DB <i>alias</i> (never the full JDBC URL / password), the scheduler + NAVER flags, coarse baseline
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
        boolean naverConnectorEnabled,
        Baseline baseline,
        String startedAt) {

    /** Coarse row counts for the disposable DB — a sanity/mismatch signal, not per-row data. */
    public record Baseline(long credentials, long syncJobs, long channelOrders, long naverAccounts) {
    }
}
