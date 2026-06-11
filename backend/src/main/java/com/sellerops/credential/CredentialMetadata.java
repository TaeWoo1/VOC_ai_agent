package com.sellerops.credential;

import java.time.Instant;
import java.util.UUID;

/**
 * The masked, read-side view of a stored credential — metadata only. This is the
 * ONLY shape the vault ever returns to read callers: no plaintext, no ciphertext,
 * no IV. Anything an API or UI shows about credentials comes from here.
 */
public record CredentialMetadata(
        UUID sellerAccountId,
        String connectorClass,
        String authType,
        String encryptionKeyId,
        Instant tokenExpiresAt,
        Instant lastRotatedAt,
        boolean hasRefreshToken) {
}
