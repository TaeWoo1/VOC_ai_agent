package com.sellerops.reviewops.dto;

/**
 * How many working issues carry each change judgement, as of the summary's reference date. These are
 * <b>counts of unvalidated candidate signals</b>, not validated findings: the issue thresholds are DRAFT
 * and the extractor's accuracy is UNMEASURED ({@code contracts/review-issue/v1/THRESHOLDS.md}). A surface
 * rendering these must speak of "확인이 필요한 변화" / "이슈 후보", never "문제가 N개 발견됨".
 *
 * @param workingTotal issues in the working list (dismissed excluded)
 * @param needsReview issues whose lifecycle is 확인 필요 (NEEDS_REVIEW)
 * @param newlyRaised issues whose change judgement includes NEW
 * @param surging issues whose change judgement includes SURGING
 * @param persistent issues whose change judgement includes PERSISTENT
 * @param concentrated issues whose change judgement includes CONCENTRATED
 * @param improved issues whose change judgement includes IMPROVED (report-only, never warrants review)
 */
public record IssueChangeCountsView(int workingTotal, int needsReview, int newlyRaised, int surging,
                                    int persistent, int concentrated, int improved) {
}
