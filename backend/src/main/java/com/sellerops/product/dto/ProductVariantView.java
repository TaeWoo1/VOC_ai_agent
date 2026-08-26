package com.sellerops.product.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * One purchasable option.
 *
 * <p>A derived variant (from {@code reviews.source_option_id}) carries an id and no {@code optionName}:
 * the review row records which option was bought, not what it is called. Naming it would be invention,
 * so the field stays null and the OPTION facet reports {@code PARTIAL}.
 *
 * <p>{@code id} is SellerOps's own row id, added 2026-08-27. It is what a seller's knowledge document
 * binds to when they scope it to one 규격 — the channel's {@code externalVariantId} is the identity
 * the CHANNEL owns and can reissue, and a knowledge scope has to survive that.
 */
public record ProductVariantView(UUID id, String channelCode, String externalVariantId, String optionName,
                                 String sku, BigDecimal price, String sellingStatus,
                                 String source, Instant observedAt) {
}
