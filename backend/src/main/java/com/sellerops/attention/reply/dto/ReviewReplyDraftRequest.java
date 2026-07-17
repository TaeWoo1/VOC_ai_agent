package com.sellerops.attention.reply.dto;

/**
 * Save one version of an operator's reply draft.
 *
 * <p>{@code baseVersion} is required — the version the edit is based on ({@code 0} for the
 * first save) — and is used for optimistic concurrency: a stale base is rejected with 409
 * rather than silently overwriting whatever landed meanwhile.
 *
 * <p>No {@code commandId}, deliberately, unlike the approval request. Idempotency here comes
 * from the content itself: an exact retry re-sends the same body against the same base, which
 * the service recognises as the head and answers without inserting a duplicate version. A
 * command id would add a second idempotency mechanism whose answer could disagree with the
 * first.
 *
 * <p>The row being drafted arrives in the path as an {@code actionRef}, not here — it is the
 * address of the thing being acted on, not part of the content.
 */
public record ReviewReplyDraftRequest(String body, Integer baseVersion) {
}
