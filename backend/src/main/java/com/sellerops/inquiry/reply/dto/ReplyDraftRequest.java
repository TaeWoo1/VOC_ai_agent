package com.sellerops.inquiry.reply.dto;

/**
 * Seller reply-draft save request. The seller edits only {@code title} and {@code
 * comments}; {@code answerStatus} is backend-fixed. {@code baseVersion} is required
 * — the version the edit is based on ({@code 0} for the first save) — and is used
 * for optimistic-concurrency (a stale base is rejected with 409).
 */
public record ReplyDraftRequest(
        String title,
        String comments,
        Integer baseVersion) {
}
