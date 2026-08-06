package com.sellerops.collect.dto;

import java.time.Instant;

/**
 * Operator-confirmation of a credential's exact expiry date (the WING-read or operator-entered date) when it
 * was unknown at connection time. Carries ONLY the date — never a secret. {@code null} clears it back to
 * unknown; a non-null value must be the exact date, never an estimate.
 */
public record CredentialExpiryConfirmRequest(Instant tokenExpiresAt) {
}
