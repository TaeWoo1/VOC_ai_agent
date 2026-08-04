package com.sellerops.connector;

import java.util.Objects;

/**
 * Internal result of a {@link ConnectionVerifier} — {@code SUCCESS} or
 * {@code FAILED} only (the caller resolves UNSUPPORTED/NOT_CONFIGURED before
 * invoking a verifier). It carries a safe {@code reasonCode} constant the
 * service maps to a fixed operator-facing message; the verifier never supplies
 * free-text, so no raw provider string can reach the API response. Kept separate
 * from the wire DTO so connectors never shape HTTP output.
 */
public record VerifyOutcome(Status status, String reasonCode) {

    public enum Status {
        SUCCESS,
        FAILED
    }

    /** Stored credential was rejected by the provider (authentication failure). */
    public static final String REASON_INVALID_CREDENTIAL = "INVALID_CREDENTIAL";
    /** Transient throttling/rate-limit — the check may succeed if retried later. */
    public static final String REASON_TEMPORARY_PROVIDER_ERROR = "TEMPORARY_PROVIDER_ERROR";
    /** Provider unreachable or 5xx/network failure — non-credential, may be transient. */
    public static final String REASON_PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE";
    /**
     * Credential is valid but the app lacks the order-API permission (e.g. the
     * 주문 API 그룹 is not granted). Distinct from a credential failure: the token
     * minted, only the order endpoint refused. Emitted only when a live-captured
     * provider error code positively identifies the permission cause; never guessed.
     */
    public static final String REASON_PERMISSION_INSUFFICIENT = "PERMISSION_INSUFFICIENT";
    /**
     * Credential is valid but the call environment is not allowed (e.g. the caller
     * egress IP is not registered in the app's 'API 호출 IP'). Emitted only when a
     * live-captured provider error code positively identifies the call-IP cause;
     * never guessed.
     */
    public static final String REASON_CALL_ENVIRONMENT_MISMATCH = "CALL_ENVIRONMENT_MISMATCH";
    /**
     * Credential is valid (token minted) but the order API refused access (HTTP 403)
     * and the cause could not be split into permission vs call-IP without a
     * live-captured provider code. The hedged, strictly-better-than-INVALID_CREDENTIAL
     * verdict: the operator is guided to check BOTH the order API group permission and
     * the 'API 호출 IP' registration. Upgrades to the specific reason above once the
     * distinguishing code is captured under approval.
     */
    public static final String REASON_ORDER_ACCESS_DENIED = "ORDER_ACCESS_DENIED";

    public VerifyOutcome {
        Objects.requireNonNull(status, "status");
    }

    public static VerifyOutcome success() {
        return new VerifyOutcome(Status.SUCCESS, null);
    }

    public static VerifyOutcome failed(String reasonCode) {
        return new VerifyOutcome(Status.FAILED, reasonCode);
    }
}
