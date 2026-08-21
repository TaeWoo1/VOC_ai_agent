package com.sellerops.product.dto;

import com.sellerops.product.KnowledgeCoverage;
import com.sellerops.product.ProductKnowledgeFacet;
import java.time.Instant;

/**
 * Whether SellerOps HOLDS one facet of a product's knowledge — the availability axis.
 *
 * <p>Reported beside {@link SignalCoverageView}, never merged with it. That one answers "can this
 * signal be attributed to this product" (an ATTRIBUTION question, {@code AttentionCoverage}); this one
 * answers "do we have this fact and how old is it". Merging them would seat
 * {@code UNCERTAIN_PRODUCT_UNLINKED} and {@link KnowledgeCoverage#STALE} in one column, and a reader
 * would lose the ability to tell "we could not attribute the reviews" from "we last read the price in
 * March".
 *
 * @param known how many stated values back this facet (listings, variants, facts). Zero with
 *     {@link KnowledgeCoverage#UNAVAILABLE} is the honest "we have never held this"
 * @param newestObservedAt the newest observation behind the facet, or null when nothing backs it —
 *     the input to the staleness verdict, exposed so a caller can say how old rather than only that
 *     it is old
 * @param provenance which sources contributed, joined — e.g. {@code NAVER:PRODUCT_API:v1+DERIVED:TITLE}
 */
public record KnowledgeCoverageView(ProductKnowledgeFacet facet, KnowledgeCoverage coverage,
                                    int known, Instant newestObservedAt, String provenance) {

    /** True when a caller may state a value from this facet without a coverage caveat. */
    public boolean isStatable() {
        return coverage.isStatable();
    }
}
