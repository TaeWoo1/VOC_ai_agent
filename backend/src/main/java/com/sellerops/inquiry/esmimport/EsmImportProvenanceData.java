package com.sellerops.inquiry.esmimport;

/**
 * File-origin metadata for one imported inquiry, destined for {@code
 * inquiry_import_provenance}. Deliberately excludes any content or PII (no body,
 * no product name, no buyer id, no answer text) — only structural origin fields.
 */
public record EsmImportProvenanceData(
        int sourceRow,
        String registrationKind,
        String inquiryType,
        String originalProductRef,
        String originalOrderRef,
        String orderType,
        String receivedAtRaw,
        String processedAtRaw,
        String fingerprint,
        int fingerprintVersion) {
}
