package com.sellerops.review.channel.dto;

import java.util.List;

/**
 * The small summary above the list: how the channel's whole review record divides, and which issue
 * categories repeat in it.
 *
 * <p><b>Counted over the whole channel, never the page.</b> A per-page count would shrink as the
 * operator paged and read as the work disappearing — the same reason
 * {@code ChannelReviewPageView.newCount} is channel-scoped.
 *
 * <p>The three tier counts and the page's ordering both come from
 * {@code ReviewRepository.TRIAGE_TIER_RANK}, so a filter chip's number and the rows it reveals cannot
 * disagree about what a tier is.
 */
public record ChannelReviewTriageSummaryView(
        long needsAttention,
        long watch,
        long fyi,
        /**
         * Categories carried by at least {@code ReviewTriageNote.REPEAT_MIN} of this channel's reviews,
         * biggest first. <b>Unwindowed</b>: it says how many of the reviews you HAVE share a category and
         * claims nothing about when — see {@code docs/slices/review-triage-v1.md} §4.1 for why a
         * "최근 N일" phrasing was dropped rather than fitted to the data.
         */
        List<RepeatedCategory> repeatedCategories) {

    /**
     * One repeating category and its count.
     *
     * <p>기타 never appears. It is a real stored verdict — "we looked and it fitted nothing" — not an
     * issue, and listing it as a repeating issue would turn the analyzer's shrug into a finding.
     */
    public record RepeatedCategory(String category, long count) {
    }
}
