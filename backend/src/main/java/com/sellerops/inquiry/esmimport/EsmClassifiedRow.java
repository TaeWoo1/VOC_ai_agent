package com.sellerops.inquiry.esmimport;

import com.sellerops.ingest.canonical.CanonicalInquiry;

/**
 * The outcome of classifying one ESM export row. Exactly one of two shapes:
 * <ul>
 *   <li><b>valid</b> — {@code reason == null}; carries the {@link CanonicalInquiry},
 *       its {@link EsmImportProvenanceData}, canonical status, and fingerprint.</li>
 *   <li><b>invalid</b> — {@code reason != null}; carries only {@code sourceRow} and
 *       the sanitized reason. Never produces an inquiry or work item.</li>
 * </ul>
 * {@code sellerId} (판매아이디, nullable) is always carried — even for invalid rows —
 * so the file-level seller-account cross-check sees every declared selling id.
 */
public record EsmClassifiedRow(
        int sourceRow,
        EsmImportReasonCode reason,
        String sellerId,
        String status,
        String fingerprint,
        CanonicalInquiry canonical,
        EsmImportProvenanceData provenance) {

    static EsmClassifiedRow invalid(int sourceRow, EsmImportReasonCode reason, String sellerId) {
        return new EsmClassifiedRow(sourceRow, reason, sellerId, null, null, null, null);
    }

    static EsmClassifiedRow valid(int sourceRow, String sellerId, String status, String fingerprint,
                                  CanonicalInquiry canonical, EsmImportProvenanceData provenance) {
        return new EsmClassifiedRow(sourceRow, null, sellerId, status, fingerprint, canonical, provenance);
    }

    public boolean valid() {
        return reason == null;
    }
}
