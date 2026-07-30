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
 *
 * <p>{@code isSecret} carries a source-provided private-post flag (Cafe24 board-6
 * 비밀글). {@code null} = the source does not classify secrecy (ESM / file upload) —
 * treated as visible everywhere. The Cafe24 connector sets it fail-closed.
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
        String informStatus,
        Boolean isSecret) {

    /**
     * Back-compat constructor for sources that do not classify secrecy (ESM, file
     * upload, mock): {@code isSecret} defaults to {@code null} (not classified).
     */
    public CanonicalInquiry(String productName, String sku, String author, String body,
                            String status, Instant receivedAt, String externalId, int sourceRow,
                            String title, String informStatus) {
        this(productName, sku, author, body, status, receivedAt, externalId, sourceRow,
                title, informStatus, null);
    }
}
