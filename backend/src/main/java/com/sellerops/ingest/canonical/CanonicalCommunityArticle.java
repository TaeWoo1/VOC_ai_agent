package com.sellerops.ingest.canonical;

import java.time.Instant;

/**
 * Source-agnostic Cafe24 community article produced by the connector before
 * persistence. {@code sourceKind} and {@code replyStatus} are raw tokens that the
 * ingestion step normalizes to their canonical closed sets. {@code sourceRow} is
 * the 1-based source position (for error reporting).
 */
public record CanonicalCommunityArticle(
        int boardNo,
        long articleNo,
        String sourceKind,
        Long productNo,
        String title,
        String content,
        Integer rating,
        String replyStatus,
        Instant sourceCreatedAt,
        Instant sourceUpdatedAt,
        int sourceRow) {
}
