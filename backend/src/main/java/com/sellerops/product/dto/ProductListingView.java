package com.sellerops.product.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One channel's listing of a product.
 *
 * <p>Nullable everywhere except the channel and the external id, because channels differ in what their
 * product read returns and a derived listing (assembled from ingested rows, no catalogue call) states
 * only that the product was seen on that channel. A null price is {@code UNAVAILABLE} coverage, never a
 * zero.
 */
public record ProductListingView(String channelCode, String channelNameKo, String channelProductId,
                                 String listingName, String productUrl, BigDecimal price,
                                 String currency, String sellingStatus, String source,
                                 Instant observedAt) {
}
