package com.sellerops.itemanalysis.dto;

/**
 * Outcome of one bounded backfill batch: how many un-analyzed items were newly analyzed
 * (split by type — inquiries are drained first), how many were skipped (defensive; the
 * query already excludes analyzed rows), and how many remain un-analyzed org-wide so the
 * operator knows whether to run another batch.
 */
public record BackfillResult(int analyzedInquiries, int analyzedReviews,
                             int skipped, long remaining) {

    /** Total newly-analyzed items in this batch. */
    public int analyzed() {
        return analyzedInquiries + analyzedReviews;
    }
}
