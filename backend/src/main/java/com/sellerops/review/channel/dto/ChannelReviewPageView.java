package com.sellerops.review.channel.dto;

import java.time.Instant;
import java.util.List;

/**
 * One page of a connected channel's reviews, plus what the last import claimed.
 *
 * <p><b>The import facts are on the page for a reason.</b> A list of reviews cannot tell the seller whether
 * it is all of their reviews — an acquisition that stopped early looks exactly like a channel with fewer
 * reviews. {@code lastImportComplete} carries the agent's own coverage claim forward, so the surface can say
 * "this is what we have" rather than implying "this is what exists".
 *
 * <p>{@code newCount} counts the reviews the most recent import brought in, over the WHOLE account rather
 * than the page — a per-page count would shrink as the operator paged and read as the number falling.
 */
public record ChannelReviewPageView(
        int page,
        int size,
        long total,
        long newCount,
        Instant lastImportAt,
        boolean lastImportComplete,
        List<ChannelReviewItemView> items) {
}
