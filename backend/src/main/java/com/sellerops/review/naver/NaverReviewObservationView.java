package com.sellerops.review.naver;

/**
 * What a delivery came to, in the only terms the helper needs: whether the store was proved, and what ingest did.
 * No review, no product and no id travels back.
 */
public record NaverReviewObservationView(String identityVerdict, int received, int inserted, int changed,
                                         int skipped, int failed) {
}
