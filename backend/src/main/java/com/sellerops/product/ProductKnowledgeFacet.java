package com.sellerops.product;

/**
 * The facets a {@link KnowledgeCoverage} verdict is reported for.
 *
 * <p>One verdict per facet rather than one per product, because the real state of a seller's catalogue
 * is uneven: a NAVER export gives a name and nothing else, Coupang gives options and no description,
 * Cafe24 gives a product number and a listing. A single product-level "we know this product" verdict
 * would be false in both directions on the same row.
 *
 * <p>{@link #SIGNALS} is here so one response can answer "what do we know" and "what is happening"
 * together — but its verdict is derived from the ATTRIBUTION axis
 * ({@code com.sellerops.attention.AttentionCoverage}), not from availability. See
 * {@code ProductKnowledgeService}.
 */
public enum ProductKnowledgeFacet {

    /** name · sku — the minimum needed to say which product is being discussed. */
    IDENTITY,

    /** channel listings: channel product id, listing name, url, selling status. */
    LISTING,

    /** price, per channel, with the time it was observed. */
    PRICE,

    /** options / variants / per-option SKUs. */
    VARIANT,

    /** brand · manufacturer · category. */
    TAXONOMY,

    /** the seller's own product description text. */
    DESCRIPTION,

    /** structured attributes / specs (길이, 두께, 용량 …). */
    SPEC,

    /** inquiry / review / issue volume for this product — the attribution axis. */
    SIGNALS
}
