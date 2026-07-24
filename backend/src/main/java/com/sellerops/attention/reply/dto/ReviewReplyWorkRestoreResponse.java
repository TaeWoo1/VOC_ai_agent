package com.sellerops.attention.reply.dto;

/**
 * The acknowledgement of a 복원 (restore) write.
 *
 * <p>{@code actionRef} echoes the row that was restored, so a client can match a response to its
 * request without relying on ordering.
 *
 * <p>{@code replayed} distinguishes "this command id had already been applied; nothing was written"
 * from a fresh write. Both are 200 — a repeated restore is idempotent success, not a conflict.
 *
 * <p><b>It asserts nothing about the reply.</b> There is no outcome, no verification and no completion
 * here: a restore only puts the review back on the reply to-do; the draft, its history, and the
 * dismissal it reverses are all untouched. Carries no timestamp and no actor — the append-only
 * {@code review_reply_work_restore} table owns the history; every field this does not carry is a field
 * that cannot leak.
 */
public record ReviewReplyWorkRestoreResponse(String actionRef, boolean replayed) {
}
