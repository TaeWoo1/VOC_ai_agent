package com.sellerops.attention.reply.dto;

import java.time.Instant;

/**
 * The operator-reported outcome for a review's CURRENT approved reply, shown next to the review.
 *
 * <p><b>Outcome and verification are two separate fields, and the surface must render both.</b>
 * {@code operatorOutcome} is what the operator reported ({@code OPERATOR_REPORTED_SUBMITTED} /
 * {@code SUBMISSION_ABORTED}); {@code verification} is what SellerOps confirmed (always
 * {@code UNVERIFIED}). Never show {@code UNVERIFIED} alone — a bare verification label with no
 * reported outcome reads as a system failure rather than an operator report, and there is no
 * {@code COMPLETED} to show at all.
 *
 * <p>Carries no reply body and no channel claim. {@code awRunRef} is null for a manual post with no
 * guided run; when present it is the opaque Action Window runId
 * the guided post ran under.
 */
public record ReviewReplyOutcomeView(String operatorOutcome, String verification,
                                     Integer recordedVersion, String recordedFingerprint,
                                     String awRunRef, Instant recordedAt) {
}
