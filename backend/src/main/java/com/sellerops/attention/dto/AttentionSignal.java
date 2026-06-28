package com.sellerops.attention.dto;

/**
 * One operator attention signal: a typed, severity-ranked count of collected VOC
 * rows that need a look. METADATA ONLY — {@code label}/{@code description} are
 * fixed operator-safe strings; this DTO deliberately carries no article
 * title/content, source identifiers, or customer PII. {@code sourceType} is the
 * operator-facing kind (REVIEW / INQUIRY); {@code channel} is the display name.
 *
 * <p>{@code spike} carries optional, additive comparison metadata for the
 * {@code RECENT_*_SPIKE_CANDIDATE} signals (current vs the prior equal-length window);
 * it is {@code null} for every routine signal.
 */
public record AttentionSignal(
        String type,
        String severity,
        long count,
        String label,
        String description,
        String sourceType,
        String channel,
        SpikeComparison spike) {

    /** Routine (non-spike) signal: no comparison metadata. */
    public AttentionSignal(String type, String severity, long count, String label,
                           String description, String sourceType, String channel) {
        this(type, severity, count, label, description, sourceType, channel, null);
    }
}
