package com.sellerops.reviewissue.dto;

import java.util.List;
import java.util.UUID;

/**
 * The evidence reviews of one issue, resolved for the reply flow, plus the DRAFT-honesty context the
 * surface must show before it lets an operator act on a candidate signal.
 *
 * <p><b>{@code extractorKind}</b> is the provenance of the signal (e.g. {@code RULE_BASED}) and
 * <b>{@code thresholdsVersion}</b> is the version of the change-detection thresholds
 * ({@code contracts/review-issue/v1}). Both are surfaced so the FE can label the issue as a DRAFT,
 * UNMEASURED candidate signal — never as a confirmed problem — exactly as
 * {@code contracts/review-issue/v1/THRESHOLDS.md} requires.
 *
 * <p>{@code selectableCount} is the number of candidates the operator may actually start a reply on
 * (unanswered, not already reported, account resolvable) — so a surface can say "3건 중 1건 답변
 *가능" without re-deriving the rule client-side.
 */
public record ReviewIssueReplyCandidatesView(
        UUID issueId,
        String extractorKind,
        String thresholdsVersion,
        int selectableCount,
        List<ReviewIssueReplyCandidateView> candidates) {
}
