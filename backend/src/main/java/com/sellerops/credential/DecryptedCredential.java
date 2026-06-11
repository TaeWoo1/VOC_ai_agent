package com.sellerops.credential;

import java.time.Instant;
import java.util.Map;

/**
 * Decrypted secret material, alive in memory only for the duration of a
 * collection run. Never persist, log, or serialize this object — the masked
 * counterpart for any surface is {@link CredentialMetadata}.
 */
public record DecryptedCredential(
        String connectorClass,
        String authType,
        Map<String, String> secrets,
        String refreshToken,
        Instant tokenExpiresAt) {

    /** Masked — a stray log statement must not leak secret material. */
    @Override
    public String toString() {
        return "DecryptedCredential[connectorClass=" + connectorClass
                + ", authType=" + authType
                + ", secrets=<masked:" + secrets.size() + ">"
                + ", refreshToken=" + (refreshToken != null ? "<masked>" : "null")
                + ", tokenExpiresAt=" + tokenExpiresAt + "]";
    }
}
