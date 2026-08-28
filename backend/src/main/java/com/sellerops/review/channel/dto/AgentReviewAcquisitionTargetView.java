package com.sellerops.review.channel.dto;

/**
 * The acquisition target the Local Agent resolves an {@code acquisitionRef} to: the channel, and the
 * {@code accountSlot} the existing review handoff is keyed by ({@code AgentReviewHandoffRequest}) —
 * so the run can hand its reading back through the route that already exists. No credential, no
 * review, no person.
 */
public record AgentReviewAcquisitionTargetView(String channelCode, String accountSlot) {
}
