package com.sellerops.connector;

/**
 * A marketplace call was refused because the stored credential / token is no longer accepted —
 * an authentication failure, <b>not</b> a transient one (network, 5xx, rate limit, malformed page).
 *
 * <p>Self-Pilot Runtime v1: this is the one signal the collection runtime turns into a
 * {@code RECONNECT_REQUIRED} task instead of a generic FAILED run (see
 * {@code com.sellerops.selfpilot.SellerAccountReauthService}). Connectors throw it only where the
 * provider's answer is unambiguous — an HTTP 401 on a signed/bearer request, a token mint the gateway
 * rejected as unauthorized, or an OAuth {@code invalid_grant} on refresh. Anything the connector cannot
 * classify with certainty stays an ordinary failure, so a flaky day never logs the seller out of a
 * channel.
 *
 * <p>The message is sanitized (channel label + cause class only). No credential material, response
 * body, or account identifier is ever carried here.
 */
public class ConnectorAuthException extends RuntimeException {

    /** Why the provider refused — coarse, closed set; safe to log and to show. */
    public enum Cause {
        /** Credential/signature rejected (HTTP 401 or equivalent). */
        CREDENTIAL_REJECTED,
        /** OAuth refresh token revoked/expired ({@code invalid_grant}). */
        REFRESH_TOKEN_REVOKED
    }

    private final Cause authCause;

    public ConnectorAuthException(String channelLabelKo, Cause cause) {
        super(channelLabelKo + " 인증이 더 이상 유효하지 않습니다 (" + cause + "). 채널을 다시 연결해 주세요.");
        this.authCause = cause;
    }

    public Cause authCause() {
        return authCause;
    }
}
