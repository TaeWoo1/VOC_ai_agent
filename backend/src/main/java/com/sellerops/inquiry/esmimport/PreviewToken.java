package com.sellerops.inquiry.esmimport;

import java.util.UUID;

/**
 * The signed claims bound at preview time. Confirm re-derives every one of these from
 * the re-uploaded file + selected account/marketplace and requires an exact match, so
 * a token can only ever authorize persisting the identical file it previewed. The
 * token is HMAC-signed and expiring — see {@link PreviewTokenService}; it is never a
 * plain/unsigned hash.
 */
public record PreviewToken(
        UUID orgId,
        UUID sellerAccountId,
        EsmMarketplace marketplace,
        String fileHash,
        String headerSignature,
        int rowCount,
        String canonicalPreviewHash,
        String existingStateHash,
        long issuedAtEpochMs,
        long expiresAtEpochMs) {
}
