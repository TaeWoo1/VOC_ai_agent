package com.sellerops.reviewissue.dto;

import java.util.List;

/**
 * One issue with its evidence and its lifecycle history.
 *
 * <p>The history is part of the detail rather than a separate call because it is what answers "why
 * was I told to look at this" months later, once the counts that triggered the transition have moved
 * on — and because the operator's own 조치 기록 lives in it.
 */
public record ReviewIssueDetailView(ReviewIssueView issue, List<IssueEvidenceView> evidence,
                                    List<IssueStateEventView> history) {
}
