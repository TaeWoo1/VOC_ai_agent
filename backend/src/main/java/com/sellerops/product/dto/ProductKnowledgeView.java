package com.sellerops.product.dto;

import java.util.List;
import java.util.UUID;

/**
 * What SellerOps knows about one product — and, with equal weight, what it does not.
 *
 * <p><b>The two coverage lists are two different questions and must both be read.</b>
 * {@code knowledgeCoverage} is availability ("do we hold this fact"); {@code signals.coverage} is
 * attribution ("can this signal be judged for this product"). A product can have perfect signal
 * coverage and no product knowledge at all, or a full catalogue read and unattributable reviews.
 *
 * <p><b>Absence is never rendered as a negative fact.</b> An empty {@code facts} list under
 * {@code SPEC = UNAVAILABLE} means "우리는 규격 정보를 갖고 있지 않습니다", never "이 상품에는 규격이
 * 없습니다". The Evidence Judge enforces that distinction at the sentence level
 * ({@code UNVERIFIED_PRODUCT_FACT}); this shape is what makes it checkable.
 */
public record ProductKnowledgeView(UUID productId, String name, String sku, String status,
                                   List<ProductListingView> listings,
                                   List<ProductVariantView> variants,
                                   List<ProductFactView> facts,
                                   ProductSignalsView signals,
                                   List<KnowledgeCoverageView> knowledgeCoverage) {
}
