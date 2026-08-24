package com.sellerops.inquiry.publish.dto;

import com.sellerops.inquiry.publish.PublishOutcomeCategory;

/**
 * The publish status the frontend renders. {@code category} is the coarse outcome
 * (publishing / completed / checking-required / retryable / permanent); {@code
 * executionStatus} is the fine state. No token or provider message text.
 *
 * <p>{@code presendStateProven} / {@code presendNote} report what the pre-send re-check could
 * establish about the target at the moment of the send — see
 * {@link com.sellerops.inquiry.publish.PreSendCheck}. Both are null until a dispatch has been
 * attempted. A false {@code presendStateProven} on a delivered reply is not a defect; it is the
 * record that the reply went out on the last state SellerOps had seen, and it is what makes that
 * fact auditable afterwards rather than only visible on the confirm screen beforehand.
 */
public record PublishStatusView(
        String workItemId,
        String phase,
        String executionStatus,
        PublishOutcomeCategory category,
        Integer approvedDraftVersion,
        String approvedFingerprint,
        String providerMessageNo,
        Integer resultCode,
        Boolean presendStateProven,
        String presendNote) {
}
