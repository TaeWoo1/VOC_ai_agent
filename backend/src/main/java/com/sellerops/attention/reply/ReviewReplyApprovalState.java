package com.sellerops.attention.reply;

import com.sellerops.common.ApiException;

/**
 * Whether an operator's reply draft currently stands as approved.
 *
 * <p>Two values, and no more, because there is no third thing that is true about an approval
 * here. "Not yet approved" is the absence of a row, not a state — the same distinction
 * {@code TriageDisposition} draws between a null disposition and {@code NO_ACTION}: never
 * having approved is not a decision, while withdrawing is.
 *
 * <p><b>Not a workflow phase</b>, for the reason {@code TriageDisposition} records at length.
 * Approving does not hand the reply to a dispatcher, because there is no dispatcher; it
 * freezes the text and marks it ready for the operator to copy. Nothing advances on its own.
 */
public enum ReviewReplyApprovalState {

    /** The current draft is frozen and copy-ready, bound to an exact version + fingerprint. */
    APPROVED,

    /** A previous approval was taken back; the draft is editable again and nothing is bound. */
    WITHDRAWN;

    /**
     * Parse an operator-supplied state; unknown → bad request.
     *
     * <p>Parsed here rather than bound by Jackson as an enum so the caller gets this message
     * instead of a deserialization error naming the Java type — matching
     * {@code TriageDisposition.parse} and {@code OperatorAttentionService.parseType}.
     */
    public static ReviewReplyApprovalState parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw ApiException.badRequest("기록할 승인 상태(state)를 지정해 주세요.");
        }
        try {
            return ReviewReplyApprovalState.valueOf(raw.strip());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("지원되지 않는 승인 상태입니다.");
        }
    }
}
