package com.sellerops.reviewissue.dto;

import java.util.UUID;

/**
 * All-time evidence count for one product behind an issue — the "특정 상품 집중" roll-up as a
 * quote-free number. Carries only the product identifier + name and a count; never a review id, a
 * quote, or a buyer identity.
 */
public record IssueProductEvidenceView(UUID productId, String productName, long evidenceCount) {
}
