package com.sellerops.attention.reply.dto;

/**
 * The collector's report about a guided reply run — what it OBSERVED in the seller's browser.
 *
 * <p>{@code state} is closed to {@code COMPOSER_FILLED} | {@code SELLER_SUBMISSION_OBSERVED}; anything
 * stronger is refused (a collector cannot assert what the channel did). {@code submissionRef} is the
 * single-use binding the run was minted with; {@code commandId} is the idempotency key.
 */
public record ReviewReplyExecutionObserveRequest(String commandId, String submissionRef, String state) {
}
