package com.sellerops.product.dto;

import com.sellerops.product.ProductMatchSurface;
import java.util.UUID;

/**
 * A product as a resolver returns it: identity, and how the seller's words reached it. No counts, no
 * verdicts — resolving "A상품" to a row is a separate question from what is happening to it, and
 * answering both in one shape would make the cheap lookup pay for the expensive rollup.
 *
 * @param matchedOn   which surface the query matched, or null for a direct id read (no query ran)
 * @param matchedName the listing title that matched, when it was a channel alias — the human-readable
 *                    name of a product whose {@code name} is a SKU number. Null otherwise.
 */
public record ProductSummaryView(UUID id, String name, String sku, String status,
                                 ProductMatchSurface matchedOn, String matchedName) {
}
