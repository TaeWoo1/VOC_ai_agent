package com.sellerops.connector.cafe24.spike;

/**
 * An operator's request for exactly one controlled board-6 comment attempt.
 *
 * <p>Carries no secret and no personal data: the target is identified by board /
 * article number, the operator asserts the article is their own test inquiry, and
 * the approval value is a single-use grant (never a credential). The comment body
 * is either the fixed harmless phrase ({@link ContentSource#FIXED}) or an operator
 * override validated by {@link SpikeContentGuard}.
 *
 * @param commandId               idempotency key for this attempt (required)
 * @param boardNo                 target board — must be 6 (product inquiry)
 * @param articleNo               target article number
 * @param operatorTestInquiryConfirmed operator asserts this is an operator-owned test inquiry
 * @param dryRun                  when true, plan only — zero external calls
 * @param approvalToken           single-use approval value; null/blank = no approval
 * @param contentSource           FIXED phrase or OPERATOR override
 * @param operatorContent         operator override text (only read when OPERATOR)
 */
public record SpikeReplyCommand(
        String commandId,
        int boardNo,
        long articleNo,
        boolean operatorTestInquiryConfirmed,
        boolean dryRun,
        String approvalToken,
        ContentSource contentSource,
        String operatorContent) {

    public SpikeReplyCommand {
        if (commandId == null || commandId.isBlank()) {
            throw new IllegalArgumentException("commandId는 필수입니다.");
        }
        if (contentSource == null) {
            contentSource = ContentSource.FIXED;
        }
    }

    /** Whether the body is the fixed test phrase or an operator-supplied override. */
    public enum ContentSource {
        FIXED,
        OPERATOR
    }

    /**
     * A stable, secret-free fingerprint of the payload for idempotency conflict
     * detection. Excludes the approval token (a single-use grant, not payload) and
     * fingerprints operator content by a non-reversible hash — never the text itself,
     * so two different bodies of equal length are not confused for a replay.
     */
    public String payloadFingerprint() {
        String contentPart = contentSource == ContentSource.OPERATOR
                ? "OP:" + (operatorContent == null ? "0"
                        : Integer.toHexString(operatorContent.strip().hashCode()))
                : "FIXED";
        return boardNo + ":" + articleNo + ":" + contentSource + ":" + contentPart
                + ":test=" + operatorTestInquiryConfirmed;
    }
}
