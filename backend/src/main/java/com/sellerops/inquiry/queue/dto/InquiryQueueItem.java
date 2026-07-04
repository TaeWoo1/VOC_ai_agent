package com.sellerops.inquiry.queue.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One sanitized row of the seller inquiry work queue. It carries the work-item and
 * connection identity ({@code sellerAccountId} — the exact seller connection), the
 * lifecycle {@code phase}, the canonical {@code status}, the seller-visible {@code
 * title}, and the receipt time. It deliberately carries <b>no</b> buyer identity
 * (no {@code author}) and <b>no</b> raw inquiry body — the list stays sanitized;
 * full details belong to a later detail endpoint.
 */
public record InquiryQueueItem(
        UUID workItemId,
        UUID inquiryId,
        UUID sellerAccountId,
        UUID channelId,
        String phase,
        String status,
        String title,
        Instant receivedAt) {
}
