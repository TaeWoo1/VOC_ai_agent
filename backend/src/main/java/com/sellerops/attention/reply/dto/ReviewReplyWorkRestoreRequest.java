package com.sellerops.attention.reply.dto;

/**
 * An operator's request to bring one review BACK onto their reply to-do (복원), reversing a prior
 * 작업에서 제외.
 *
 * <p>{@code commandId} is the client's idempotency key, unique per org. It is required — an absent one
 * is a bad request, never a silently non-idempotent write. Clients should mint one per user intent
 * (not per retry), so a retried request is recognised as the same restore.
 *
 * <p>The row being restored arrives in the path as an {@code actionRef}, not here.
 */
public record ReviewReplyWorkRestoreRequest(String commandId) {
}
