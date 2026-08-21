package com.sellerops.product;

/**
 * Whether SellerOps HAS a product fact — a different question from whether a signal can be attributed.
 *
 * <p><b>Why this is not {@code AttentionCoverage}.</b> That enum answers "can this signal be judged for
 * this scope" (COVERED / UNCERTAIN_MULTI_ACCOUNT / UNCERTAIN_UNSUPPORTED_CHANNEL /
 * UNCERTAIN_PRODUCT_UNLINKED) — an ATTRIBUTION question. This one answers "do we hold this fact, and
 * how old is it" — an AVAILABILITY question. Folding them together would seat
 * {@code UNCERTAIN_PRODUCT_UNLINKED} and {@link #STALE} in the same column, and a reader would have no
 * way to tell "we could not attribute the reviews" from "we last read the price in March". A product
 * response carries both enums side by side, one per axis.
 *
 * <p><b>{@link #UNAVAILABLE} is the load-bearing value.</b> "정보가 없음" and "사실이 아님" are
 * different claims, and the whole Product Knowledge layer exists because the product used to answer the
 * second when it only knew the first. The Evidence Judge refuses a sentence that asserts a product fact
 * over an UNAVAILABLE or STALE facet ({@code UNVERIFIED_PRODUCT_FACT}).
 */
public enum KnowledgeCoverage {

    /** Held, from a stated source, inside the freshness bound. */
    AVAILABLE,

    /** Held for some channels/items and not others — a partial picture, honestly labelled. */
    PARTIAL,

    /** Never held. NOT "the product does not have this". */
    UNAVAILABLE,

    /** Held, but the newest observation is older than the freshness bound for this facet. */
    STALE;

    /** True when a caller may state a fact from this facet without a coverage caveat. */
    public boolean isStatable() {
        return this == AVAILABLE;
    }
}
