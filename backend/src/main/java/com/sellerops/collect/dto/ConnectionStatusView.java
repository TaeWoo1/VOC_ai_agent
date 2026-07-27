package com.sellerops.collect.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Connection-health panel payload. {@code state} is the collection health
 * (CONNECTED / DEGRADED / ...), or {@code NOT_COLLECTED} when no run has ever
 * touched this account. {@code nextScheduledAt} is the earliest enabled
 * schedule's next run, if any.
 *
 * <p>{@code sessionReadiness} reconciles a DIFFERENT axis onto the same panel:
 * the marketplace session's liveness (login / 2FA / expiry) the local-agent
 * observed, mirroring {@code contracts/session-readiness/v1}. It is kept
 * separate from {@code state} on purpose — a channel can be sync-healthy yet
 * have an expired login, and vice versa — and defaults to
 * {@code UNOBSERVED_EXTERNAL} when no probe has run, never a guessed READY.
 * {@code sessionObservedAt} is when that reading was last written.
 */
public record ConnectionStatusView(
        UUID sellerAccountId,
        String state,
        Instant lastSuccessAt,
        int consecutiveFailures,
        String lastError,
        Instant lastSyncedAt,
        Instant nextScheduledAt,
        String sessionReadiness,
        Instant sessionObservedAt) {
}
