package com.sellerops.producttruth;

import java.time.LocalDate;
import java.util.List;

/**
 * PRODUCT_NARRATIVE — the human-owned description of why the product exists and how it is meant to
 * be used.
 *
 * <p>It carries no status, no mode and no evidence, because it may not make a capability claim.
 * Anything in a narrative body that would be a capability claim belongs in
 * {@link ProductCapability}; anything not yet built belongs in {@link ProductRoadmapItem}.
 */
public record ProductNarrative(
        String id,
        String title,
        String body,
        List<String> sourceRefs,
        ProductReviewState review,
        LocalDate lastReviewed) {
}
