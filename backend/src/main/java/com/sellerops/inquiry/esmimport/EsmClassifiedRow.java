package com.sellerops.inquiry.esmimport;

import com.sellerops.ingest.canonical.CanonicalInquiry;

/**
 * The outcome of classifying one ESM export row. Its {@link EsmMessageKind} is decided
 * first from structured columns; only a {@link EsmMessageKind#BUYER_INQUIRY} row can
 * persist. Shapes:
 * <ul>
 *   <li><b>valid buyer</b> — kind {@code BUYER_INQUIRY}, {@code reason == null}; carries
 *       the {@link CanonicalInquiry}, its {@link EsmImportProvenanceData}, canonical
 *       status, and fingerprint.</li>
 *   <li><b>invalid buyer</b> — kind {@code BUYER_INQUIRY}, {@code reason != null}; a
 *       malformed buyer row (bad timestamp, missing body, contradictory status). Never
 *       persists.</li>
 *   <li><b>operational notice</b> — kind {@code PLATFORM_OPERATIONAL_NOTICE}; a valid
 *       source row intentionally excluded (not an error). Never persists.</li>
 *   <li><b>unsupported</b> — kind {@code UNSUPPORTED_OR_UNKNOWN}; fail-closed. Never
 *       persists.</li>
 * </ul>
 * {@code sellerId} (판매아이디, nullable) is always carried — even for excluded/invalid
 * rows — so the file-level seller-account cross-check sees every declared selling id.
 */
public record EsmClassifiedRow(
        int sourceRow,
        EsmMessageKind kind,
        EsmImportReasonCode reason,
        String sellerId,
        String status,
        String fingerprint,
        CanonicalInquiry canonical,
        EsmImportProvenanceData provenance) {

    static EsmClassifiedRow invalid(int sourceRow, EsmImportReasonCode reason, String sellerId) {
        return new EsmClassifiedRow(sourceRow, EsmMessageKind.BUYER_INQUIRY, reason, sellerId,
                null, null, null, null);
    }

    static EsmClassifiedRow valid(int sourceRow, String sellerId, String status, String fingerprint,
                                  CanonicalInquiry canonical, EsmImportProvenanceData provenance) {
        return new EsmClassifiedRow(sourceRow, EsmMessageKind.BUYER_INQUIRY, null, sellerId, status,
                fingerprint, canonical, provenance);
    }

    /** A platform operational notice — a valid source row that is intentionally excluded. */
    static EsmClassifiedRow operationalNotice(int sourceRow, String sellerId) {
        return new EsmClassifiedRow(sourceRow, EsmMessageKind.PLATFORM_OPERATIONAL_NOTICE, null,
                sellerId, null, null, null, null);
    }

    /** An unrecognized (fail-closed) row — never a buyer inquiry, never persisted. */
    static EsmClassifiedRow unsupported(int sourceRow, String sellerId) {
        return new EsmClassifiedRow(sourceRow, EsmMessageKind.UNSUPPORTED_OR_UNKNOWN, null,
                sellerId, null, null, null, null);
    }

    /** True only for a persistable buyer inquiry (kind BUYER_INQUIRY with no reject reason). */
    public boolean valid() {
        return kind == EsmMessageKind.BUYER_INQUIRY && reason == null;
    }

    /** A buyer inquiry row (valid or invalid) — the only kind that yields a batch. */
    public boolean buyerInquiry() {
        return kind == EsmMessageKind.BUYER_INQUIRY;
    }

    public boolean operationalNotice() {
        return kind == EsmMessageKind.PLATFORM_OPERATIONAL_NOTICE;
    }

    public boolean unsupported() {
        return kind == EsmMessageKind.UNSUPPORTED_OR_UNKNOWN;
    }

    /** True for a non-buyer kind — intentionally excluded, never persisted. */
    public boolean excluded() {
        return kind != EsmMessageKind.BUYER_INQUIRY;
    }
}
