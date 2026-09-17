package com.sellerops.inquiry.naver;

/**
 * What a delivery came to, in the only terms the helper needs: whether the store was proved, how far the page
 * reached, and what ingest did. No inquiry, no product and no id travels back.
 */
public record NaverProductInquiryObservationView(String identityVerdict, String coverage, int received, int inserted,
                                                 int changed, int skipped, int failed) {
}
