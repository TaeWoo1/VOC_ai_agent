package com.sellerops.connector.coupang;

import java.time.Duration;
import java.time.Instant;

/**
 * PURE, sanitized expiry model for a Coupang WING Open API credential — computed
 * (never stored) from the credential's {@code token_expires_at} against a caller-
 * supplied reference {@code now} plus an auth-failure signal. No wall-clock is read
 * inside this class: {@code now} is always a parameter, so the state machine is
 * fully deterministic and unit-testable at every boundary.
 *
 * <p><b>Never carries a secret.</b> The fields are the exact expiry date (a
 * non-secret WING field), a computed {@code daysRemaining}, a coarse {@code state}
 * bucket, and two booleans — nothing decrypted, no Access/Secret Key, no vendor id.
 *
 * <p><b>State rules</b> (see {@code docs/coupang_credential_expiry_audit_v1.md} and
 * the pinned design):
 * <ul>
 *   <li>{@code expiresAt == null} → {@link State#UNKNOWN} (offer an operator-confirm
 *       path; SellerOps NEVER stores an estimate).</li>
 *   <li>days-remaining {@code > 30} → {@link State#OK}; {@code ≤30} → {@link State#WARN_30};
 *       {@code ≤14} → {@link State#WARN_14}; {@code ≤7} → {@link State#WARN_7};
 *       {@code ≤1} (but not yet passed) → {@link State#WARN_1}.</li>
 *   <li>the expiry date has passed AND the connection is auth-failing →
 *       {@link State#EXPIRED} (the strong verdict).</li>
 *   <li>the expiry date has passed but auth is NOT failing → {@link State#DATE_PASSED}
 *       (the soft "date passed — verify" verdict).</li>
 * </ul>
 * A 401 / auth failure <b>alone</b>, without the date having passed, is <b>not</b>
 * EXPIRED — the credential stays OK/WARN by its date. Only date-passed + auth-failing
 * escalates to EXPIRED.
 */
public record CoupangCredentialExpiryStatus(
        Instant expiresAt,
        Integer daysRemaining,
        State state,
        boolean authFailing,
        boolean renewRecommended) {

    /** Coarse expiry bucket, escalating with proximity to (and past) the expiry date. */
    public enum State {
        /** No stored expiry date — unknown; never an estimate. */
        UNKNOWN,
        /** More than 30 days remaining. */
        OK,
        /** 30 days or fewer remaining (but more than 14). */
        WARN_30,
        /** 14 days or fewer remaining (but more than 7). */
        WARN_14,
        /** 7 days or fewer remaining (but more than 1). */
        WARN_7,
        /** 1 day or fewer remaining, not yet passed. */
        WARN_1,
        /** The expiry date has passed but auth is not (yet) failing — verify. */
        DATE_PASSED,
        /** The expiry date has passed AND the connection is auth-failing. */
        EXPIRED
    }

    private static final long SECONDS_PER_DAY = Duration.ofDays(1).getSeconds();

    /**
     * Compute the expiry status. {@code now} is the reference instant (a parameter —
     * no wall-clock is read here); {@code authFailing} is the connection-health signal
     * (typically {@code consecutiveFailures > 0}, or a just-failed connection test).
     */
    public static CoupangCredentialExpiryStatus compute(Instant expiresAt, Instant now, boolean authFailing) {
        if (now == null) {
            throw new IllegalArgumentException("now must be provided");
        }
        if (expiresAt == null) {
            // Unknown expiry — never guessed. renewRecommended stays false; authFailing is still surfaced.
            return new CoupangCredentialExpiryStatus(null, null, State.UNKNOWN, authFailing, false);
        }

        boolean datePassed = !expiresAt.isAfter(now); // expiresAt <= now
        int daysRemaining = ceilDays(now, expiresAt);

        State state;
        if (datePassed) {
            state = authFailing ? State.EXPIRED : State.DATE_PASSED;
        } else if (daysRemaining > 30) {
            state = State.OK;
        } else if (daysRemaining > 14) {
            state = State.WARN_30;
        } else if (daysRemaining > 7) {
            state = State.WARN_14;
        } else if (daysRemaining > 1) {
            state = State.WARN_7;
        } else {
            state = State.WARN_1;
        }

        boolean renewRecommended = switch (state) {
            case WARN_14, WARN_7, WARN_1, DATE_PASSED, EXPIRED -> true;
            default -> false;
        };
        return new CoupangCredentialExpiryStatus(expiresAt, daysRemaining, state, authFailing, renewRecommended);
    }

    /** ceil((expiresAt - now) / 1 day), signed — negative once the date has passed. */
    private static int ceilDays(Instant now, Instant expiresAt) {
        long seconds = Duration.between(now, expiresAt).getSeconds();
        return (int) Math.ceil(seconds / (double) SECONDS_PER_DAY);
    }
}
