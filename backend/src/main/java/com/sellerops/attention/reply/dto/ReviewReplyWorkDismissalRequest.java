package com.sellerops.attention.reply.dto;

/**
 * An operator's request to set one review aside (작업에서 제외) from their reply to-do.
 *
 * <p>{@code commandId} is the client's idempotency key, unique per org. It is required — an absent
 * one is a bad request, never a silently non-idempotent write. Clients should mint one per user
 * intent (not per retry), so a retried request is recognised as the same dismissal.
 *
 * <p>The row being dismissed arrives in the path as an {@code actionRef}, not here.
 */
public record ReviewReplyWorkDismissalRequest(String commandId) {
}
