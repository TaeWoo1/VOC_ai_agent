package com.sellerops.attention.dto;

/**
 * One collected VOC row behind an attention signal — the channel-generic drill-down
 * unit. METADATA ONLY: deliberately no article title/content, {@code articleNo},
 * {@code productNo}, source/customer/order/product identifiers, or {@code mall_id};
 * there is no free-text preview field (a sanitized preview is a documented follow-up,
 * gated on a real PII sanitizer that does not yet exist).
 *
 * <p>{@code sourceType} is the operator-facing kind (REVIEW / INQUIRY);
 * {@code channelCode}/{@code channelNameKo} identify the channel; dates are KST
 * calendar dates (date only), {@code sourceCreatedDate} null when the source value
 * was timezone-less. {@code signalType} echoes the requesting
 * {@link com.sellerops.attention.AttentionSignalType}.
 */
public record OperatorVocItem(
        String channelCode,
        String channelNameKo,
        String sourceType,
        Integer rating,
        String replyStatus,
        String sourceCreatedDate,
        String collectedDate,
        String signalType) {
}
