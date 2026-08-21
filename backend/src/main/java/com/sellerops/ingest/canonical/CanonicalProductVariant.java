package com.sellerops.ingest.canonical;

import java.math.BigDecimal;

/**
 * One purchasable option of a {@link CanonicalProduct}.
 *
 * <p>{@code externalVariantId} is the channel's own option id — Coupang {@code vendorItemId} (already
 * stored on {@code reviews.source_option_id} since V37 with nothing to resolve it against), NAVER
 * {@code optionId}, Cafe24 variant code. It is the identity, so a re-read updates rather than
 * duplicates.
 */
public record CanonicalProductVariant(
        String externalVariantId,
        String optionName,
        String sku,
        BigDecimal price,
        String rawSellingStatus) {
}
