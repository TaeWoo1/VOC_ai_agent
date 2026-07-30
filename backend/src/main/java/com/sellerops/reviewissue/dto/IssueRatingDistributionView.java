package com.sellerops.reviewissue.dto;

/**
 * How the evidence behind an issue distributes across star ratings — one bucket per rating plus an
 * {@code unrated} bucket for evidence whose review carried no star. Counted per evidence unit, so
 * the six buckets sum to the issue's total evidence. Pure counts; no review text.
 */
public record IssueRatingDistributionView(long rating1, long rating2, long rating3, long rating4,
                                          long rating5, long unrated) {
}
