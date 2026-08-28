package com.sellerops.review.channel.dto;

import com.sellerops.review.publish.ReviewExecutionCapability;
import com.sellerops.review.triage.ReviewTriageChannelCapability;

/**
 * One row of {@code contracts/review-triage-events/v1/CONTRACT.md} §1, for the page that renders it —
 * plus the execution column the Agent reasons with (Agentic Operating Workspace v2 §A2).
 * Closed vocabularies only — a channel code, four capability values, one reason — nothing about the
 * account beyond what its grant makes true.
 *
 * @param channelCode     {@code NAVER} | {@code CAFE24} | {@code COUPANG} | any other code SellerOps
 *                        knows; the three are the contract's, everything else is outside it
 * @param aiTriage        the channel is inside the AI triage pilot; false ⇒ no mark, no feedback control
 * @param originalLocate  {@code NONE} | {@code LOCATE_RUN} — how the seller can be shown the original
 * @param replySupported  the product has a reply flow for this channel (never true for Coupang)
 * @param executionKind   {@code API_EXECUTION} | {@code GUIDED_BROWSER_EXECUTION} | {@code NOT_SUPPORTED}
 *                        — how an APPROVED reply reaches the channel, as built AND configured for this
 *                        account (Cafe24 is API only with the lane on and the write grant recorded)
 * @param executionReason why {@code NOT_SUPPORTED}, when it is ({@code ReviewExecutionReason} name), else null
 */
public record ReviewChannelCapabilityView(String channelCode, boolean aiTriage, String originalLocate,
                                          boolean replySupported, String executionKind,
                                          String executionReason) {

    public static ReviewChannelCapabilityView of(ReviewTriageChannelCapability c,
                                                 ReviewExecutionCapability.Decision execution) {
        return new ReviewChannelCapabilityView(c.channelCode(), c.aiTriage(), c.originalLocate().name(),
                c.replySupported(), execution.kind().name(),
                execution.reason() == null ? null : execution.reason().name());
    }
}
