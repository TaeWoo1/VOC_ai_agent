package com.sellerops.inbox.dto;

import java.time.Instant;

/** A unified inbox row — either an inquiry or a review. */
public record FeedItem(
        String type,          // INQUIRY | REVIEW
        String channelNameKo,
        String productName,
        String snippet,
        Integer rating,        // null for inquiries
        String status,         // UNANSWERED/ANSWERED for inquiries; NEGATIVE/NORMAL for reviews
        Instant receivedAt) {
}
