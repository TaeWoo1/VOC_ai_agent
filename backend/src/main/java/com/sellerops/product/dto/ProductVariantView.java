package com.sellerops.product.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One purchasable option.
 *
 * <p>A derived variant (from {@code reviews.source_option_id}) carries an id and no {@code optionName}:
 * the review row records which option was bought, not what it is called. Naming it would be invention,
 * so the field stays null and the OPTION facet reports {@code PARTIAL}.
 */
public record ProductVariantView(String channelCode, String externalVariantId, String optionName,
                                 String sku, BigDecimal price, String sellingStatus,
                                 String source, Instant observedAt) {
}
