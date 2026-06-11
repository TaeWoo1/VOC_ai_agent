package com.sellerops.collect.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Connection-health panel payload. {@code state} is the collection health
 * (CONNECTED / DEGRADED / ...), or {@code NOT_COLLECTED} when no run has ever
 * touched this account. {@code nextScheduledAt} is the earliest enabled
 * schedule's next run, if any.
 */
public record ConnectionStatusView(
        UUID sellerAccountId,
        String state,
        Instant lastSuccessAt,
        int consecutiveFailures,
        String lastError,
        Instant lastSyncedAt,
        Instant nextScheduledAt) {
}
