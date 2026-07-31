package com.sellerops.inquiry.guidedhandoff.dto;

/**
 * Record the operator's report about their own manual reply on the Cafe24 admin.
 *
 * <p>{@code commandId} is the client's idempotency key (required; a blank one is a bad
 * request, never a silently non-idempotent write). Reusing it for a <em>different</em>
 * outcome is a 409; an exact replay is a 200 no-op.
 *
 * <p>{@code operatorOutcome} is what the operator reports happened — either
 * {@code OPERATOR_REPORTED_SUBMITTED} or {@code SUBMISSION_ABORTED}. Verification is NOT a
 * client field: the record is always UNVERIFIED. The actual completion is the separate
 * connector reconcile when the answer is re-collected as 처리완료 — never this report.
 */
public record InquiryGuidedHandoffOutcomeRequest(String commandId, String operatorOutcome) {
}
