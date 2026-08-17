package com.sellerops.inbox.dto;

import java.time.Instant;

/** A unified inbox row — either an inquiry or a review. */
public record FeedItem(
        String id,            // source row UUID (inquiry/review); join key for item-analysis
        String type,          // INQUIRY | REVIEW
        String channelId,     // catalog channel UUID; lets a client resolve the row to its account (2026-08-18)
        String channelNameKo,
        String productName,
        String snippet,
        Integer rating,        // null for inquiries
        String status,         // UNANSWERED/ANSWERED for inquiries; NEGATIVE/NORMAL for reviews
        Instant receivedAt) {
}
