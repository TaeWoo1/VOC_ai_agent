package com.sellerops.inquiry.proposal.dto;

import java.util.UUID;

/**
 * Result of a propose request: the work item's (now PROPOSED) phase and the
 * attached proposal. Returned identically for a fresh transition and an idempotent
 * replay.
 */
public record ProposalResult(
        UUID workItemId,
        String phase,
        ProposalView proposal) {
}
