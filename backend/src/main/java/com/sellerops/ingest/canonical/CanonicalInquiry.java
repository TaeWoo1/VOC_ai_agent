package com.sellerops.ingest.canonical;

import java.time.Instant;

/**
 * Source-agnostic inquiry record. {@code status} is the canonical binary
 * {@code UNANSWERED}/{@code ANSWERED}; {@code informStatus} is the raw
 * source-provided reply-status token (e.g. ESM+ {@code 미처리}/{@code 처리완료}),
 * kept verbatim for evidence/verification. {@code sourceRow} is the 1-based
 * originating file row (for error reporting).
 *
 * <p><b>PII:</b> {@code author} carries the source-provided writer/buyer id when
 * a mapper still reads it (the file-upload path). It is <b>no longer persisted</b>
 * — {@link com.sellerops.ingest.IngestionService} deliberately drops it — so no
 * buyer PII lands in storage; the field remains only to keep existing mappers
 * unchanged. The ESM connector path leaves it {@code null}.
 *
 * <p>{@code title} is the seller-visible inquiry subject (persisted, sanitized-
 * safe for the owning seller). The ESM reply {@code token} is never carried here —
 * it is parsed and discarded upstream (encrypted persistence is deferred).
 */
public record CanonicalInquiry(
        String productName,
        String sku,
        String author,
        String body,
        String status,
        Instant receivedAt,
        String externalId,
        int sourceRow,
        String title,
        String informStatus) {
}
