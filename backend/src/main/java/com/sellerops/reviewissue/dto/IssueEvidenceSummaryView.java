package com.sellerops.reviewissue.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * A quote-free roll-up of the evidence behind one issue: how much there is, how it splits across
 * products and star ratings, and the span it covers.
 *
 * <p>Backs the agent-facing {@code GET /api/review-issues/{id}/evidence-summary} read. This is the
 * "sanitized evidence summary" an operations brief is allowed to carry — deliberately NOT the
 * evidence rows: no review id, no opinion-unit quote (masked or otherwise), no buyer identity. The
 * human detail surface ({@link ReviewIssueDetailView}) is where the masked quotes live; an agent
 * never needs them and this shape cannot carry them.
 *
 * @param totalEvidence all-time evidence unit count for the issue
 * @param byProduct attributed products largest-first; {@code unattributed} is reported separately
 *     rather than folded in, so a gap in product mapping can never masquerade as a product
 * @param unattributedEvidence evidence units whose review had no product mapping
 * @param ratingDistribution per-star counts (plus unrated); sums to {@code totalEvidence}
 */
public record IssueEvidenceSummaryView(long totalEvidence, List<IssueProductEvidenceView> byProduct,
                                       long unattributedEvidence,
                                       IssueRatingDistributionView ratingDistribution,
                                       LocalDate firstEvidenceOn, LocalDate lastEvidenceOn) {
}
