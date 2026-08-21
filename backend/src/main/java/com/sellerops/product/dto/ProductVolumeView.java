package com.sellerops.product.dto;

/**
 * The raw volume behind a product's signals, so a reader can weigh them.
 *
 * <p>Reported alongside {@link SignalCoverageView} rather than instead of it: three linked reviews and
 * three hundred both produce a number here, and only the coverage row says whether the number is the
 * whole story. {@code unansweredInquiries} counts inquiries linked to this product that are still
 * UNANSWERED — the same status the org-wide 미답변 number is derived from, narrowed by product.
 */
public record ProductVolumeView(long reviews, long inquiries, long unansweredInquiries,
                                long issueEvidence) {
}
