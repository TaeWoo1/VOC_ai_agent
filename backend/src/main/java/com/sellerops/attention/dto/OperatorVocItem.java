package com.sellerops.attention.dto;

/**
 * One collected VOC row behind an attention signal — the channel-generic drill-down
 * unit. METADATA ONLY: deliberately no raw article title/content, {@code articleNo},
 * {@code productNo}, source/customer/order/product identifiers, or {@code mall_id}.
 *
 * <p>{@code safePreview} is the one free-text field: a sanitized, length-limited
 * preview produced read-time by {@link com.sellerops.common.VocPreviewSanitizer} —
 * never the raw body. It is {@code null} when the source was empty or the sanitizer
 * suppressed it (too much redacted); the raw text is never exposed either way.
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
        String signalType,
        String safePreview) {
}
