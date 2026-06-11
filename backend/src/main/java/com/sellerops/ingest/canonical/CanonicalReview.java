package com.sellerops.ingest.canonical;

import java.time.Instant;

/** Source-agnostic review record produced by any connector before persistence.
 *  {@code sourceRow} is the 1-based originating file row (for error reporting). */
public record CanonicalReview(
        String productName,
        String sku,
        Integer rating,
        String body,
        Instant receivedAt,
        String externalId,
        int sourceRow) {
}
