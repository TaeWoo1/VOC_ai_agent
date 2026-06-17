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
