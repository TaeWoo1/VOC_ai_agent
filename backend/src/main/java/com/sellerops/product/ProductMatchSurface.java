package com.sellerops.product;

/**
 * Which surface a seller's words matched — carried out with the candidate, not inferred from its rank.
 *
 * <p><b>Declaration order is the precedence</b> ({@code ordinal()} is the rank), and it puts every
 * exact match above the one partial one: a complete name the seller typed beats a fragment that
 * happens to be contained in another product's name.
 *
 * <p>It exists because "several candidates" and "several EQUALLY GOOD candidates" are different
 * answers. An exact SKU plus three substring hits is resolved; two listings whose titles are the same
 * string is not resolvable at all, and only the surface makes those two distinguishable to a caller.
 */
public enum ProductMatchSurface {

    /** {@code products.sku} equals the query. */
    SKU_EXACT,

    /** {@code products.name} equals the query. */
    CANONICAL_NAME_EXACT,

    /**
     * A channel listing of this product carries the query as its title — the name a human actually
     * reads on the marketplace, which for a Coupang/Cafe24-derived catalogue is the only readable one
     * ({@code products.name} there is a SKU number).
     */
    CHANNEL_PRODUCT_NAME_EXACT,

    /** {@code products.name} contains the query. The one inexact surface, and deliberately last. */
    CANONICAL_NAME_PARTIAL,

    /** No query was given: the catalogue head. Never competes with a match. */
    CATALOG_HEAD;

    /** True when the seller's words matched something whole. A tie among these cannot be broken. */
    public boolean exact() {
        return this == SKU_EXACT || this == CANONICAL_NAME_EXACT || this == CHANNEL_PRODUCT_NAME_EXACT;
    }
}
