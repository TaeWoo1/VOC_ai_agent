package com.sellerops.ingest.canonical;

import java.time.Instant;

/** Source-agnostic inquiry record. status is UNANSWERED or ANSWERED.
 *  {@code sourceRow} is the 1-based originating file row (for error reporting). */
public record CanonicalInquiry(
        String productName,
        String sku,
        String author,
        String body,
        String status,
        Instant receivedAt,
        String externalId,
        int sourceRow) {
}
