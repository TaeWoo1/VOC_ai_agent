package com.sellerops.producttruth;

import java.time.LocalDate;
import java.util.List;

/**
 * A CURRENT_PRODUCT_TRUTH statement that is not about one channel × object — the product-level
 * facts a seller-facing answer may rely on everywhere.
 *
 * <p>Separate from {@link ProductCapability} because it has no axis and no mode: an invariant is not
 * a capability with the channel left blank, and giving it those fields would invite one to be
 * written as the other.
 */
public record ProductInvariant(
        String id,
        String title,
        String statement,
        /** What this invariant explicitly does NOT say — the over-generalisation it is here to stop. */
        List<String> notThis,
        List<String> sourceRefs,
        ProductReviewState review,
        LocalDate lastReviewed) {
}
