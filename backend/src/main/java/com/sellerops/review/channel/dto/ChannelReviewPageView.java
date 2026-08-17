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
        /**
         * Whether RUBRIC v2 §13.7's pilot is ON for this org. False for every org not opted in — and
         * then the surface renders no mark, no feedback controls, and records no behaviour, so the
         * screen is what it was before the pilot existed. On the wire because the frontend must not
         * guess this from the presence of marks: a page with no marks on it is not evidence the pilot
         * is off.
         */
        boolean aiPilotEnabled,
        /**
         * How the channel's whole record divides by tier, and what repeats in it. Always the UNFILTERED
         * picture, even when the page itself is filtered to one tier — a summary recomputed under its own
         * filter would collapse to the one option the operator already chose, and there would be no way
         * back. Same rule as the attention drill-down's category breakdown.
         */
        ChannelReviewTriageSummaryView triageSummary,
        List<ChannelReviewItemView> items) {
}
