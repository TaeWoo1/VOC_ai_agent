package com.sellerops.attention.reply.dto;

/**
 * Optional body for {@code POST /reply/submission-run}.
 *
 * <p>When {@code requireTargetHint} is true (guided preparation), the server derives AND validates the review
 * target hint <b>before</b> minting the {@code submissionRef}: a review that cannot produce a valid hint
 * (missing rating or blank body) 409s and mints nothing, so a missing hint can never leave an unusable
 * single-use ref. Absent or false preserves the legacy mint-only behavior (no hint on the response).
 */
public record ReviewReplySubmissionRunRequest(Boolean requireTargetHint) {
}
