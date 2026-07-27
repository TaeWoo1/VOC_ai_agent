package com.sellerops.reviewissue;

import java.util.UUID;

/**
 * Evidence count for one product within a window. Used by the concentration rollup.
 *
 * <p>Rows with no product are excluded by the query rather than grouped under null: "unattributed"
 * is not a product, and letting missing data form the largest group would let a gap in product
 * mapping manufacture a 특정 상품 집중 verdict.
 */
public record ProductEvidenceCount(UUID productId, long evidenceCount) {
}
