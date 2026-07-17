package com.sellerops.attention.reply.dto;

/**
 * Approve or withdraw approval of a review's reply draft.
 *
 * <p>{@code state} is a {@link com.sellerops.attention.reply.ReviewReplyApprovalState} name
 * carried as a String and parsed in the service, so an unknown value answers with the
 * surface's own message instead of a Jackson deserialization error naming a Java type —
 * matching how {@code TriageDecisionRequest} handles {@code disposition}.
 *
 * <p>{@code commandId} is the client's idempotency key, unique per org. It is required: an
 * absent one is a bad request, never a silently non-idempotent write. Clients should mint one
 * per user intent (not per retry) so a retried request is recognisable as the same decision.
 *
 * <p>{@code baseVersion} is the draft version being approved — required for {@code APPROVED},
 * and null for {@code WITHDRAWN} (a withdrawal binds nothing). It is what stops an operator
 * approving a version they never saw: if the head has moved on, the approval is refused rather
 * than silently binding to newer text.
 */
public record ReviewReplyApprovalRequest(String commandId, String state, Integer baseVersion) {
}
