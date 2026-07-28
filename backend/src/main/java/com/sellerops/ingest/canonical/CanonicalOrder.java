package com.sellerops.ingest.canonical;

import java.time.Instant;
import java.time.LocalDate;

/**
 * Source-agnostic per-order (product-order granularity) record. Carries only fields a channel
 * actually returns — no buyer PII (name / phone / address / memo) and no raw payload. Normalization
 * of {@code rawStatusCode} into a canonical status is done at ingestion, not here, so this record
 * stays a faithful projection of the source.
 *
 * <p>Identity is {@code externalOrderId} (the channel's stable per-line id — NAVER's
 * {@code productOrderId}); {@code parentOrderId} (NAVER's {@code orderId}) is the payment-unit
 * grouping. {@code summaryDate} is the KST bucket the daily summary already uses, so the two stay
 * consistent. {@code paidAt}/{@code statusChangedAt} are stored only when the source supplies them.
 * {@code sourceRow} is the 1-based originating position (for error reporting).
 */
public record CanonicalOrder(
        String externalOrderId,
        String parentOrderId,
        String rawStatusCode,
        long paymentAmount,
        LocalDate summaryDate,
        Instant paidAt,
        Instant statusChangedAt,
        int sourceRow) {
}
