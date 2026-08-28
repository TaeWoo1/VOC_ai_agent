package com.sellerops.review.publish;

import java.time.Instant;

/**
 * One execution row on the wire. {@code status}/{@code verification}/{@code reason} are the closed
 * words of this package; {@code category} is derived for the screen. No body, no customer field.
 */
public record ReviewExecutionView(String lane, String status, String category, String verification,
                                  String reason, String providerRef, Integer approvedVersion,
                                  String approvedFingerprint, Instant recordedAt, boolean replayed) {

    public static ReviewExecutionView of(ReviewReplyExecution e, boolean replayed) {
        return new ReviewExecutionView(e.getLane().name(), e.getStatus().name(),
                ReviewExecutionCategory.of(e.getStatus(), e.getVerification(), e.getReason()).name(),
                e.getVerification() == null ? null : e.getVerification().name(),
                e.getReason() == null ? null : e.getReason().name(),
                e.getProviderRef(), e.getApprovedVersion(), e.getApprovedFingerprint(), e.getCreatedAt(),
                replayed);
    }
}
