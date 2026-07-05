package com.sellerops.inquiry.proposal.dto;

import java.util.UUID;

/**
 * Sanitized view of a persisted inquiry proposal: coarse decision metadata plus
 * provider provenance. Carries no reply body, no inquiry body, and no buyer identity.
 */
public record ProposalView(
        UUID proposalId,
        UUID workItemId,
        UUID inquiryId,
        String actionKind,
        String summaryCategory,
        boolean requiresApproval,
        String proposedBy,
        String providerKind,
        String providerName,
        String providerVersion) {
}
