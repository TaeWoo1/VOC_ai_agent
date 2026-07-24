package com.sellerops.attention.reply.dto;

/**
 * The acknowledgement of a 작업에서 제외 (set-aside) write.
 *
 * <p>{@code actionRef} echoes the row that was dismissed, so a client can match a response to its
 * request without relying on ordering.
 *
 * <p>{@code replayed} distinguishes "this command id had already been applied; nothing was written"
 * from a fresh write. Both are 200 — a repeated dismissal is idempotent success, not a conflict.
 *
 * <p><b>It asserts nothing about the reply.</b> There is no outcome, no verification and no
 * completion here: a dismissal only removes the review from the reply to-do, and the draft and its
 * history are untouched. Carries no timestamp and no actor — the append-only
 * {@code review_reply_work_dismissal} table owns the history; every field this does not carry is a
 * field that cannot leak.
 */
public record ReviewReplyWorkDismissalResponse(String actionRef, boolean replayed) {
}
