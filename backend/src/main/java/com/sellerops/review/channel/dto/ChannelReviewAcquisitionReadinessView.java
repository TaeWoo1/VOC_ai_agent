package com.sellerops.review.channel.dto;

/**
 * Can this account start a screen read, and if not, which precondition is missing.
 *
 * <p>{@code state} is a closed token ({@code ScreenReadReadiness}); the sentence is the screen's. The
 * channel code rides along because the panel that renders this is channel-specific in its wording and
 * should not have to join another read to learn which marketplace it is talking about.
 *
 * <p>This read mints nothing and reaches no marketplace.
 */
public record ChannelReviewAcquisitionReadinessView(String state, String channelCode) {
}
