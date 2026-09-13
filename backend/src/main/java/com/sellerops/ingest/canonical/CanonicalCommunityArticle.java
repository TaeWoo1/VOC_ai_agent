package com.sellerops.ingest.canonical;

import java.time.Instant;

/**
 * Source-agnostic Cafe24 community article produced by the connector before
 * persistence. {@code sourceKind} and {@code replyStatus} are raw tokens that the
 * ingestion step normalizes to their canonical closed sets. {@code sourceRow} is
 * the 1-based source position (for error reporting).
 *
 * <p>{@code attachmentCount} is how many files the source said were attached, or null when it did not
 * say. Null is not zero: it reaches {@code reviews.media_count_observed = false}. The array it was
 * measured from has no field here or anywhere else in the connector.
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
        int sourceRow,
        Integer attachmentCount) {

    /** For sources that do not report attachments at all — the count is unobserved, not zero. */
    public CanonicalCommunityArticle(int boardNo, long articleNo, String sourceKind, Long productNo,
                                     String title, String content, Integer rating, String replyStatus,
                                     Instant sourceCreatedAt, Instant sourceUpdatedAt, int sourceRow) {
        this(boardNo, articleNo, sourceKind, productNo, title, content, rating, replyStatus,
                sourceCreatedAt, sourceUpdatedAt, sourceRow, null);
    }
}
