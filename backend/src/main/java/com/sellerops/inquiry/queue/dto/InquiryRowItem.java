package com.sellerops.inquiry.queue.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One sanitized customer inquiry as a ROW (Query Accuracy v1, 2026-08-28) — the inquiry itself, not a
 * work item. {@code workItemId}/{@code phase} are present only while an open or proposed work item exists
 * for it, so a row the seller can draft on and a row that is merely shown are told apart by the field,
 * never by a guess. No buyer identity, no raw body — the same floor as {@link InquiryQueueItem}.
 */
public record InquiryRowItem(
        UUID inquiryId,
        UUID workItemId,
        UUID sellerAccountId,
        UUID channelId,
        String channelCode,
        String channelNameKo,
        UUID productId,
        String productName,
        String phase,
        String status,
        String title,
        Instant receivedAt,
        Instant answeredAt,
        String sourceSubtype,
        String executableIdentity) {
}
