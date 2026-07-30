package com.sellerops.reviewissue.dto;

import java.util.List;

/**
 * One issue's identity and lifecycle history, with no customer text at all.
 *
 * <p>Backs the agent-facing {@code GET /api/review-issues/{id}/context} read. Unlike
 * {@link ReviewIssueDetailView} (the human detail surface, which additionally carries the masked
 * evidence quotes and the operator's notes), this view is deliberately quote-free and note-free:
 * the {@link ReviewIssueView} is built entirely from closed-vocabulary labels and aggregate counts,
 * and the history is projected through {@link IssueTransitionView}, which drops the free-text note.
 * So nothing an operations-brief agent reads here is customer- or operator-authored prose.
 */
public record IssueContextView(ReviewIssueView issue, List<IssueTransitionView> history) {
}
