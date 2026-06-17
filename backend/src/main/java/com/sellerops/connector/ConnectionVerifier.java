package com.sellerops.connector;

/**
 * Opt-in capability: a connector that can verify stored credentials against its
 * provider with a minimal authenticated request — <b>auth/connectivity only, no
 * data collection</b>. A connector declares the capability by also implementing
 * this interface; the test-connection endpoint checks {@code instanceof} and
 * resolves {@link VerifyOutcome.Status#UNSUPPORTED UNSUPPORTED} for any connector
 * that does not.
 *
 * <p>This is deliberately separate from {@link PullConnector}: forcing a verify
 * method onto every connector would make the generic {@link MockApiConnector}
 * answer, and a mock "success" must never be able to masquerade as a real
 * connection check. Because the mock does not implement this interface, the
 * fallback path can only ever be UNSUPPORTED — the structural guard behind the
 * product rule that "연결 확인됨" requires a real provider success.
 *
 * <p>No connector implements this yet; real per-connector verification (a minimal
 * authenticated request behind the connector's enabled flag) is a later slice.
 * Implementations must: pull plaintext secrets themselves via
 * {@link com.sellerops.credential.CredentialVault#open} (never receive them in
 * {@link VerifyContext}); perform no data collection, persist nothing, create no
 * sync job; and return only operator-safe outcomes — never a raw provider
 * response body, header, URL, token, or error string.
 */
public interface ConnectionVerifier {

    /**
     * Verify the stored credential for the context's account against the provider.
     * Returns {@link VerifyOutcome.Status#SUCCESS} or {@link VerifyOutcome.Status#FAILED}
     * only — the caller decides UNSUPPORTED/NOT_CONFIGURED before reaching here.
     */
    VerifyOutcome verifyConnection(VerifyContext context);
}
