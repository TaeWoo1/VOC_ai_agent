package com.sellerops.collect.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.time.Instant;
import java.util.Map;

/**
 * Write-only credential intake. Secrets go straight into the vault and are never
 * echoed back — the response is the masked {@code CredentialMetadata} only.
 */
public record CredentialIntakeRequest(
        @NotBlank String connectorClass,
        @NotBlank String authType,
        @NotEmpty Map<String, String> secrets,
        String refreshToken,
        Instant tokenExpiresAt) {

    /** Masked — request objects must never leak secrets into logs. */
    @Override
    public String toString() {
        return "CredentialIntakeRequest[connectorClass=" + connectorClass
                + ", authType=" + authType
                + ", secrets=<masked:" + (secrets != null ? secrets.size() : 0) + ">"
                + ", refreshToken=" + (refreshToken != null ? "<masked>" : "null")
                + ", tokenExpiresAt=" + tokenExpiresAt + "]";
    }
}
