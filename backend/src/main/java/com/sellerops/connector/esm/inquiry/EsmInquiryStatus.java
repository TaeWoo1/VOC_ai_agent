package com.sellerops.connector.esm.inquiry;

/**
 * The ESM+ (G마켓/옥션) seller-center inquiry (판매자 문의 / 고객 문의) reply-status
 * vocabulary, as observed at doc level. The official surface distinguishes three
 * states (미처리 / 처리중 / 처리완료); the internal {@link
 * com.sellerops.ingest.canonical.CanonicalInquiry} model is intentionally binary
 * ({@code UNANSWERED} / {@code ANSWERED}). This enum keeps the richer source
 * vocabulary explicit for evidence/verification while {@link #toCanonicalStatus()}
 * collapses it to the canonical pair.
 *
 * <p><b>Status: NEEDS_VERIFICATION.</b> The exact raw tokens / status codes the
 * official INQUIRY API returns are not yet confirmed against a captured live
 * response — {@link #from(String)} therefore matches on the doc-level Korean
 * labels and tolerant aliases, and falls back to {@link #UNKNOWN} for anything it
 * does not recognize (it never throws). Nothing here marks INQUIRY CONFIRMED or
 * changes connector capabilities.
 *
 * <p><b>Collapse rule:</b> {@code 처리중} (in progress) collapses to {@code
 * UNANSWERED}, not {@code ANSWERED} — an in-progress inquiry still needs operator
 * action, mirroring {@link com.sellerops.ingest.map.InquiryRowMapper}'s
 * fail-toward-unanswered default for the upload path.
 */
public enum EsmInquiryStatus {

    /** 미처리 — received, no reply yet. */
    UNPROCESSED("UNANSWERED"),
    /** 처리중 — reply in progress; still needs operator action. */
    IN_PROGRESS("UNANSWERED"),
    /** 처리완료 — reply completed. */
    PROCESSED("ANSWERED"),
    /** Unrecognized / blank source token; treated as needing attention. */
    UNKNOWN("UNANSWERED");

    private final String canonicalStatus;

    EsmInquiryStatus(String canonicalStatus) {
        this.canonicalStatus = canonicalStatus;
    }

    /**
     * Normalize a raw source status token to this enum. Never throws; an
     * unrecognized or blank value returns {@link #UNKNOWN}. Matching is
     * lower-cased and substring-based so trivial decorations (e.g. "답변완료")
     * still resolve.
     */
    public static EsmInquiryStatus from(String raw) {
        if (raw == null || raw.isBlank()) {
            return UNKNOWN;
        }
        String s = raw.strip().toLowerCase();
        if (s.contains("처리완료") || s.contains("답변완료") || s.contains("완료")
                || s.equals("answered") || s.equals("done") || s.equals("complete")
                || s.equals("completed")) {
            return PROCESSED;
        }
        if (s.contains("처리중") || s.contains("진행") || s.equals("in_progress")
                || s.equals("inprogress") || s.equals("pending")) {
            return IN_PROGRESS;
        }
        if (s.contains("미처리") || s.contains("미답변") || s.equals("unanswered")
                || s.equals("new") || s.equals("open")) {
            return UNPROCESSED;
        }
        return UNKNOWN;
    }

    /** The canonical binary status ({@code UNANSWERED} or {@code ANSWERED}). */
    public String toCanonicalStatus() {
        return canonicalStatus;
    }
}
