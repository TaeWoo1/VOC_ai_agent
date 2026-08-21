package com.sellerops.product.dto;

import java.util.UUID;

/**
 * A product as a resolver returns it: identity and nothing else. No counts, no verdicts — resolving
 * "A상품" to a row is a separate question from what is happening to it, and answering both in one
 * shape would make the cheap lookup pay for the expensive rollup.
 */
public record ProductSummaryView(UUID id, String name, String sku, String status) {
}
