package com.sellerops.attention.reply.dto;

/**
 * The result of starting a guided reply-submission run: an opaque, single-use {@code submissionRef}
 * the client passes into the Action Window {@code START_RUN}.
 *
 * <p>{@code submissionRef} binds the run to the approved head WITHOUT carrying any review identity or
 * reply text across the Action Window boundary — the client already holds the approved body and
 * resolves the ref to it. It is single-use: once an outcome is recorded against it, it is spent, and
 * a retry requires a fresh call here (which re-confirms the current approved head).
 *
 * <p>{@code approvedVersion} echoes the head the ref was minted against, so the client can confirm it
 * is guiding the version it means to. No body, no channel-side id.
 */
public record ReviewReplySubmissionRunResponse(String actionRef, String submissionRef,
                                               Integer approvedVersion) {
}
