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
        List<Row> items,
        /**
         * What each channel in scope can answer that the organisation cannot: the one account a row's detail and
         * `[쿠팡에서 보기]` act through (null when the org holds none or several on that channel), that channel's
         * capability row, and its last import. The channel record used to carry these for its one channel.
         */
        List<ChannelFacts> channelFacts,
        /**
         * Reviews this organisation holds on channels OUTSIDE the seller-visible set — a file-uploaded G마켓
         * export, for instance. Not listed here (the visible set is a product decision); counted, so 「전체」 is
         * never read as every review the organisation has.
         */
        long outsideVisibleChannels) {

    public record ChannelFacts(String channelCode, String channelNameKo, java.util.UUID accountId,
                               ReviewChannelCapabilityView capability, java.time.Instant lastImportAt,
                               boolean lastImportComplete) {
    }

    /** One row, with the channel it came from — the one fact a per-channel page never needed to say. */
    public record Row(String channelCode, String channelNameKo, ChannelReviewItemView review) {
    }
}
