package com.sellerops.attention.reply.dto;

/**
 * Execute the approved review reply at its channel.
 *
 * <p>{@code commandId} is the client's idempotency key, unique per org — required. {@code
 * expectedFingerprint} is the approved head's fingerprint AS THE CLIENT SAW IT; a mismatch is a 409
 * and nothing is sent, so a screen that fell behind an edit-and-re-approve cannot send words the
 * seller never read.
 */
public record ReviewReplyExecuteRequest(String commandId, String expectedFingerprint) {
}
