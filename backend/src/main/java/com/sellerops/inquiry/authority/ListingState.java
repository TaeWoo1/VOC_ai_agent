package com.sellerops.inquiry.authority;

import com.sellerops.product.SellingStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One listing's stored selling state — the input of an ENTITY.LISTING step. Built from {@code channel_products} and
 * {@code product_variants} rows; option labels are the seller's own, never the customer's words.
 *
 * @param listingStatus null when no listing row exists
 */
public record ListingState(UUID productId, SellingStatus listingStatus, Instant listingAsOf, List<Option> options) {

    public record Option(String label, SellingStatus status, Instant asOf) {
    }

    public ListingState {
        options = options == null ? List.of() : List.copyOf(options);
    }
}
