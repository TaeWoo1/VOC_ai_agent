package com.sellerops.review.channel.dto;

import java.util.List;

/**
 * One page of the organisation's review record — every seller-visible channel at once, or the one the seller
 * filtered to (UI/UX v2 Phase 2).
 *
 * <p><b>The same record, not a new one.</b> The rows, the order, the tier filter and the summary mean exactly what
 * {@link ChannelReviewPageView}'s do; the scope is a set of channels instead of one. What a per-channel page says
 * about ONE channel — its capability row, its last import — is not here, because the organisation has no single
 * answer to it: each row carries its own channel instead, and the channel record still answers the rest.
 *
 * <p>{@code channels} names the channels this page actually covered, so a screen never has to guess what 「전체」
 * meant.
 */
public record ReviewRecordPageView(
        int page,
        int size,
        long total,
        /** Reviews each channel's most recent import brought in, summed over the channels in scope. */
        long newCount,
        boolean aiPilotEnabled,
        List<String> channels,
        /** The UNFILTERED picture of the channels in scope — the same rule as the channel page's summary. */
        ChannelReviewTriageSummaryView triageSummary,
        List<Row> items) {

    /** One row, with the channel it came from — the one fact a per-channel page never needed to say. */
    public record Row(String channelCode, String channelNameKo, ChannelReviewItemView review) {
    }
}
