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
 * treated as visible everywhere. The Cafe24 connector sets it fail-closed. A source whose
 * API publishes no such field leaves it {@code null} — 없는 필드를 추측하지 않는다.
 *
 * <p>{@code sourceSubtype} names WHICH resource of a channel produced this row (see
 * {@link com.sellerops.inquiry.InquirySourceSubtype}); {@code null} for a channel that has only
 * one inquiry resource.
 *
 * <p>{@code productRef} is the channel's own product identifier, and its presence is an
 * instruction — see {@link ChannelProductRef}. {@code null} keeps the legacy name/SKU
 * resolve-or-create path unchanged for every source that already used it.
 *
 * <p>{@code answerBody}/{@code answeredAt} carry the answer the seller ALREADY published on the
 * platform, for the sources that return it. Null when the source states only a flag — never
 * synthesized from {@code status}.
 *
 * <p>{@code threadRole} is the source's own structural role for this row — see {@link
 * SourceThreadRole}. {@code null} means the source publishes no thread structure and claims nothing.
 * {@code threadParentExternalId} is the parent's identifier <b>in this source's own external-id
 * space</b> (the same string the parent row is stored under), so the relation joins without a second
 * identifier vocabulary and without a second table. It is set only on a {@code REPLY}.
 *
 * <p>{@code orderRef} is the channel's own ORDER identifier for this inquiry, and its presence is an
 * instruction in exactly the way {@code productRef} is — see {@link ChannelOrderRef}. {@code null}
 * means the source declares no order lane at all (file upload, ESM, NAVER 상품 문의); {@link
 * ChannelOrderRef#absent()} means the source has one and this row carries nothing. Buyer identity is
 * not carried here under any name.
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
        Boolean isSecret,
        String sourceSubtype,
        ChannelProductRef productRef,
        String answerBody,
        Instant answeredAt,
        ChannelOrderRef orderRef,
        SourceThreadRole threadRole,
        String threadParentExternalId) {

    /** Back-compat: every source that publishes no thread structure. */
    public CanonicalInquiry(String productName, String sku, String author, String body,
                            String status, Instant receivedAt, String externalId, int sourceRow,
                            String title, String informStatus, Boolean isSecret, String sourceSubtype,
                            ChannelProductRef productRef, String answerBody, Instant answeredAt,
                            ChannelOrderRef orderRef) {
        this(productName, sku, author, body, status, receivedAt, externalId, sourceRow, title,
                informStatus, isSecret, sourceSubtype, productRef, answerBody, answeredAt, orderRef,
                null, null);
    }

    /** Back-compat: every source that declares no order lane. */
    public CanonicalInquiry(String productName, String sku, String author, String body,
                            String status, Instant receivedAt, String externalId, int sourceRow,
                            String title, String informStatus, Boolean isSecret, String sourceSubtype,
                            ChannelProductRef productRef, String answerBody, Instant answeredAt) {
        this(productName, sku, author, body, status, receivedAt, externalId, sourceRow, title,
                informStatus, isSecret, sourceSubtype, productRef, answerBody, answeredAt, null,
                null, null);
    }

    /**
     * Back-compat constructor for sources that do not classify secrecy (ESM, file
     * upload, mock): {@code isSecret} defaults to {@code null} (not classified).
     */
    public CanonicalInquiry(String productName, String sku, String author, String body,
                            String status, Instant receivedAt, String externalId, int sourceRow,
                            String title, String informStatus) {
        this(productName, sku, author, body, status, receivedAt, externalId, sourceRow,
                title, informStatus, null, null, null, null, null, null, null, null);
    }

    /**
     * Back-compat constructor for a source that classifies secrecy but has only one inquiry
     * resource and resolves products by name/SKU (Cafe24).
     */
    public CanonicalInquiry(String productName, String sku, String author, String body,
                            String status, Instant receivedAt, String externalId, int sourceRow,
                            String title, String informStatus, Boolean isSecret) {
        this(productName, sku, author, body, status, receivedAt, externalId, sourceRow,
                title, informStatus, isSecret, null, null, null, null, null, null, null);
    }
}
