package com.sellerops.inquiry.esmimport;

/**
 * Resolves an ESM row's canonical answered/unanswered status from its 처리상태 token
 * and its answer evidence (답변내용 / 처리일시). The matrix is deliberately strict:
 * status and answer evidence must agree, otherwise the row is rejected rather than
 * guessed. This keeps a spam/attention decision from silently flipping on a
 * contradictory or ambiguous export row.
 *
 * <pre>
 *   처리상태            answer evidence   → verdict
 *   미처리 / 처리중       none            → UNANSWERED
 *   미처리 / 처리중       present         → INVALID (CONTRADICTORY_STATUS)
 *   처리완료 / 답변완료   (any)           → ANSWERED
 *   blank / unknown      none            → UNANSWERED
 *   blank / unknown      present         → INVALID (AMBIGUOUS_STATUS)
 * </pre>
 */
public final class EsmInquiryStatusClassifier {

    /** Canonical status strings shared with {@code CanonicalInquiry.status}. */
    public static final String UNANSWERED = "UNANSWERED";
    public static final String ANSWERED = "ANSWERED";

    private EsmInquiryStatusClassifier() {
    }

    /**
     * @param rawStatus       처리상태 verbatim (nullable/blank allowed)
     * @param answerPresent   답변내용 is nonblank
     * @param processedPresent 처리일시 is nonblank
     */
    public static Verdict classify(String rawStatus, boolean answerPresent, boolean processedPresent) {
        boolean hasAnswerEvidence = answerPresent || processedPresent;
        Category category = categorize(rawStatus);
        return switch (category) {
            case DONE -> Verdict.of(ANSWERED);
            case UNPROCESSED, IN_PROGRESS -> hasAnswerEvidence
                    ? Verdict.invalid(EsmImportReasonCode.CONTRADICTORY_STATUS)
                    : Verdict.of(UNANSWERED);
            case UNKNOWN -> hasAnswerEvidence
                    ? Verdict.invalid(EsmImportReasonCode.AMBIGUOUS_STATUS)
                    : Verdict.of(UNANSWERED);
        };
    }

    private static Category categorize(String raw) {
        if (raw == null || raw.isBlank()) {
            return Category.UNKNOWN;
        }
        String s = raw.strip().toLowerCase();
        if (s.contains("처리완료") || s.contains("답변완료") || s.contains("완료")
                || s.equals("answered") || s.equals("done") || s.equals("complete") || s.equals("completed")) {
            return Category.DONE;
        }
        if (s.contains("미처리") || s.equals("unprocessed") || s.equals("new") || s.equals("open")) {
            return Category.UNPROCESSED;
        }
        if (s.contains("처리중") || s.contains("진행") || s.equals("in_progress")
                || s.equals("inprogress") || s.equals("pending")) {
            return Category.IN_PROGRESS;
        }
        return Category.UNKNOWN;
    }

    private enum Category { UNPROCESSED, IN_PROGRESS, DONE, UNKNOWN }

    /** A resolved status, or an invalid-row reason. */
    public record Verdict(String canonicalStatus, EsmImportReasonCode reason) {

        static Verdict of(String canonicalStatus) {
            return new Verdict(canonicalStatus, null);
        }

        static Verdict invalid(EsmImportReasonCode reason) {
            return new Verdict(null, reason);
        }

        public boolean valid() {
            return canonicalStatus != null;
        }
    }
}
