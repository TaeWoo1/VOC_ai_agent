package com.sellerops.review.channel.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One row of the channel review list.
 *
 * <p>{@code preview} is the redacted one-line snippet ({@code VocPreviewSanitizer}), not the review body —
 * a list is for recognising an item, and the full text lives one click away in the detail. A review whose
 * snippet would be mostly redaction tokens carries no preview at all rather than a line of {@code [번호]}.
 *
 * <p>{@code isNew} means "arrived in the most recent import", derived rather than stored: a review's
 * {@code created_at} against that import's start. Nothing is marked read, and nothing is unmarked — the
 * question the seller asks after a sync is "what came in this time", not "what have I not opened".
 */
public record ChannelReviewItemView(
        UUID id,
        LocalDate writtenOn,
        Integer rating,
        boolean negative,
        String preview,
        String productName,
        String productId,
        String vendorItemId,
        int mediaCount,
        boolean isNew) {
}
