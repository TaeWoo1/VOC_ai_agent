package com.sellerops.review.channel.dto;

/**
 * What the seller's browser gets back when a Coupang review read is started from a conversation: an
 * opaque, single-use {@code acquisitionRef} for the Action Window {@code START_RUN
 * {intent: REVIEW_ACQUISITION}}, and the channel of the screen the run will read. Nothing else — the
 * account the ref binds to is resolved by the Local Agent over its own session.
 */
public record ChannelReviewAcquisitionRunResponse(String acquisitionRef, String channelCode) {
}
