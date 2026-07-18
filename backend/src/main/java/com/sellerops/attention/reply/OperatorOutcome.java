package com.sellerops.attention.reply;

import com.sellerops.common.ApiException;

/**
 * What the operator reports happened at the guided reply-submit barrier — recorded as a fact about
 * their own manual action, never as a claim about NAVER.
 *
 * <p><b>Kept strictly separate from verification.</b> This says what the operator did;
 * {@link VerificationState} says what SellerOps confirmed (always {@code UNVERIFIED} — no read-back
 * oracle exists). The two never collapse into one label, because a bare "unverified" with no
 * reported outcome would read as a system failure rather than an operator report.
 *
 * <p><b>{@code SUBMISSION_ABORTED} is an outcome, not a blocker.</b> An operator who decides not to
 * post reached a deliberate, benign end — not a fault. There is no {@code BLOCKER_CODE} for it.
 *
 * <p>No {@code COMPLETED}, and no third "success" value: a reply post cannot be verified, so the
 * runtime terminal is {@code OPERATOR_REPORTED} and this is the only vocabulary the record carries.
 */
public enum OperatorOutcome {

    /** The operator reports they pasted the approved reply into NAVER and submitted it. Unverified. */
    OPERATOR_REPORTED_SUBMITTED,

    /** The operator reports they did NOT submit (declined / aborted). A normal end, not a failure. */
    SUBMISSION_ABORTED;

    /**
     * Parse an operator-supplied outcome; unknown → bad request.
     *
     * <p>Parsed here rather than bound by Jackson as an enum so the caller gets this message
     * instead of a deserialization error naming the Java type — matching
     * {@link ReviewReplyApprovalState#parse}.
     */
    public static OperatorOutcome parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw ApiException.badRequest("기록할 제출 결과(operatorOutcome)를 지정해 주세요.");
        }
        try {
            return OperatorOutcome.valueOf(raw.strip());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("지원되지 않는 제출 결과입니다.");
        }
    }
}
