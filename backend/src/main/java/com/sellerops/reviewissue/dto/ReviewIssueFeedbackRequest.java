package com.sellerops.reviewissue.dto;

/**
 * Record the operator's judgement about a repeated-issue candidate.
 *
 * <p>{@code commandId} is the client's idempotency key, unique per org — required (an absent one is a
 * bad request, never a silently non-idempotent write).
 *
 * <p>{@code kind} is a {@link com.sellerops.reviewissue.ReviewIssueFeedbackKind} name carried as a
 * String and parsed in the service ({@code USEFUL} | {@code NOT_RELEVANT} | {@code LATER}).
 */
public record ReviewIssueFeedbackRequest(String commandId, String kind) {
}
