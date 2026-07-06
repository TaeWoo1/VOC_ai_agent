package com.sellerops.inquiry.esmimport;

import java.util.UUID;

/** Immutable per-confirm identity + binding values handed to the single-transaction apply. */
public record EsmImportContext(
        UUID orgId,
        UUID sellerAccountId,
        UUID channelId,
        EsmMarketplace marketplace,
        String filename,
        String fileHash,
        String headerSignature,
        String canonicalPreviewHash,
        int rowCount,
        UUID uploadedBy) {
}
