package com.sellerops.review.channel.dto;

import com.sellerops.review.triage.ReviewTriageChannelCapability;

/**
 * One row of {@code contracts/review-triage-events/v1/CONTRACT.md} §1, for the page that renders it.
 * Closed vocabularies only — a channel code, three capability values — nothing about the account.
 *
 * @param channelCode    {@code NAVER} | {@code CAFE24} | {@code COUPANG} | any other code SellerOps
 *                       knows; the three are the contract's, everything else is outside it
 * @param aiTriage       the channel is inside the AI triage pilot; false ⇒ no mark, no feedback control
 * @param originalLocate {@code NONE} | {@code LOCATE_RUN} — how the seller can be shown the original
 * @param replySupported the product has a reply flow for this channel (never true for Coupang)
 */
public record ReviewChannelCapabilityView(String channelCode, boolean aiTriage, String originalLocate,
                                          boolean replySupported) {

    public static ReviewChannelCapabilityView of(ReviewTriageChannelCapability c) {
        return new ReviewChannelCapabilityView(c.channelCode(), c.aiTriage(), c.originalLocate().name(),
                c.replySupported());
    }
}
