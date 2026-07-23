package com.sellerops.attention.reply.dto;

/**
 * Record an operator-reported reply submission.
 *
 * <p>{@code commandId} is the client's idempotency key, unique per org — required (an absent one is a
 * bad request, never a silently non-idempotent write).
 *
 * <p>{@code submissionRef} is the single-use binding returned by the submission-run mint; the server
 * sources the recorded version + fingerprint from it, so the client never names them.
 *
 * <p>{@code operatorOutcome} is what the operator reports happened — a
 * {@link com.sellerops.attention.reply.OperatorOutcome} name carried as a String and parsed in the
 * service ({@code OPERATOR_REPORTED_SUBMITTED} | {@code SUBMISSION_ABORTED}). Verification is NOT a
 * client field — it is always {@code UNVERIFIED}.
 *
 * <p>{@code awRunRef} is the opaque Action Window runId a guided post ran under, or {@code null}
 * for a MANUAL post with no guided run. A blank string is normalised to null — a caller that has no
 * run must say so by omission, never by inventing a placeholder.
 */
public record ReviewReplyOutcomeRequest(String commandId, String submissionRef, String operatorOutcome,
                                        String awRunRef) {
}
