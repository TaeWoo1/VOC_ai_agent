package com.sellerops.collect.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Result of a manual, explicit test-connection. Auth/connectivity only — it
 * never implies collection. The payload is deliberately minimal and safe: it
 * <b>never</b> carries a provider response body, header, request URL, token, or
 * any secret/ciphertext/IV. {@code message} is one of a fixed operator-safe set
 * and {@code reasonCode} is a safe constant (or null).
 *
 * @param status     one of {@code SUCCESS | FAILED | UNSUPPORTED | NOT_CONFIGURED}
 * @param checkedAt  when the check was performed
 * @param message    short, safe, Korean operator-facing text
 * @param reasonCode safe machine-readable code, or null
 */
public record ConnectionTestResultView(
        UUID sellerAccountId,
        String status,
        Instant checkedAt,
        String message,
        String reasonCode) {
}
