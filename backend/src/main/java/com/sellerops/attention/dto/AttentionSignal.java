package com.sellerops.attention.dto;

/**
 * One operator attention signal: a typed, severity-ranked count of collected VOC
 * rows that need a look. METADATA ONLY — {@code label}/{@code description} are
 * fixed operator-safe strings; this DTO deliberately carries no article
 * title/content, source identifiers, or customer PII. {@code sourceType} is the
 * operator-facing kind (REVIEW / INQUIRY); {@code channel} is the display name.
 */
public record AttentionSignal(
        String type,
        String severity,
        long count,
        String label,
        String description,
        String sourceType,
        String channel) {
}
