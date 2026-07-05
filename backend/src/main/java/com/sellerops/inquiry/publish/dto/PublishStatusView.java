package com.sellerops.inquiry.publish.dto;

import com.sellerops.inquiry.publish.PublishOutcomeCategory;

/**
 * The publish status the frontend renders. {@code category} is the coarse outcome
 * (publishing / completed / checking-required / retryable / permanent); {@code
 * executionStatus} is the fine state. No token or provider message text.
 */
public record PublishStatusView(
        String workItemId,
        String phase,
        String executionStatus,
        PublishOutcomeCategory category,
        Integer approvedDraftVersion,
        String approvedFingerprint,
        String providerMessageNo,
        Integer resultCode) {
}
