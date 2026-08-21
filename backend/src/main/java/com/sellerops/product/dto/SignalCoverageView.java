package com.sellerops.product.dto;

import com.sellerops.attention.AttentionCoverage;

/**
 * Whether one signal source can safely answer FOR ONE PRODUCT — the product-scoped form of the
 * false-calm guard.
 *
 * <p>This deliberately reuses {@link AttentionCoverage} rather than introducing a second coverage
 * vocabulary. The guard it enforces is the same one that slice introduced for the review-attention
 * surface ({@code docs/slices/attention-coverage-false-calm-v1.md}): an empty answer must never be
 * rendered as "nothing is wrong" when the truth is "we could not attribute the data". A product
 * report has exactly that failure mode one level down — Cafe24 promoted reviews carry
 * {@code productId = null} and Coupang review rows are keyed on an option id — so an unlinked channel
 * is reported as {@link AttentionCoverage#UNCERTAIN_PRODUCT_UNLINKED}, not as a quiet zero.
 *
 * @param signal which evidence source this row is about — {@code REVIEW_ISSUE} / {@code ITEM_ANALYSIS}
 *     / {@code REVIEW} / {@code INQUIRY} / {@code CUSTOMER_MEMORY}. The same closed set the Operator's
 *     {@code EvidenceRef.kind} uses, so a coverage row and the evidence it qualifies name the same thing
 * @param coverage the verdict; {@link AttentionCoverage#COVERED} is the ONLY value on which a zero
 *     from this source may be read as a measured zero
 * @param linked rows from this source that ARE attributed to this product
 * @param unlinked rows from this source that carry no product link at all — reported separately rather
 *     than folded in, the discipline {@code IssueEvidenceSummaryView.unattributedEvidence} already keeps
 * @param provenance which producer stands behind this signal, as {@code name/KIND:version} (e.g.
 *     {@code issue-memory/RULE_BASED:issue-rules-v1}). Read from the stored analyzer/extractor
 *     provenance columns — never a hardcoded label, for the same reason {@code draftKindLabel} is not
 */
public record SignalCoverageView(String signal, AttentionCoverage coverage, long linked, long unlinked,
                                 String provenance) {

    /** The four signal names, kept as constants so a producer and a reader cannot drift apart. */
    public static final String REVIEW_ISSUE = "REVIEW_ISSUE";
    public static final String ITEM_ANALYSIS = "ITEM_ANALYSIS";
    public static final String REVIEW = "REVIEW";
    public static final String INQUIRY = "INQUIRY";
    public static final String CUSTOMER_MEMORY = "CUSTOMER_MEMORY";

    /** True when this source may NOT be read as having measured a zero. */
    public boolean isUncertain() {
        return coverage.isUncertain();
    }
}
