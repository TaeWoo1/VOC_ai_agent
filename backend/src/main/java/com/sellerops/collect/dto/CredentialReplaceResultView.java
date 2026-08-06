package com.sellerops.collect.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Result of an atomic credential replacement (guided renewal). Auth/connectivity
 * only — it never implies collection, and the payload is deliberately minimal and
 * safe: it <b>never</b> carries a secret, ciphertext, IV, provider response body,
 * header, or request URL. On failure the previously-stored credential has already
 * been restored (rollback) before this view is returned.
 *
 * @param status     {@code SUCCESS} (new credential verified and kept) or
 *                   {@code FAILED} (new credential rejected; the old one was restored)
 * @param reasonCode safe machine-readable code on failure, or null on success
 * @param message    short, safe, Korean operator-facing text
 * @param tokenExpiresAt the expiry date now on file (the new one on success, the
 *                   restored old one on failure); null when unknown
 */
public record CredentialReplaceResultView(
        UUID sellerAccountId,
        String status,
        String reasonCode,
        String message,
        Instant tokenExpiresAt) {
}
