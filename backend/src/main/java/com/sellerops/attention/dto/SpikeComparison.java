package com.sellerops.attention.dto;

/**
 * Structured comparison metadata for the {@code RECENT_*_SPIKE_CANDIDATE} signals:
 * the current window versus the immediately preceding equal-length window. AGGREGATE
 * COUNTS ONLY — the same numbers already stated in the signal's description — so it
 * carries no article title/content, source identifiers, or customer PII. It is
 * {@code null} on every non-spike {@link AttentionSignal}.
 *
 * @param previousCount count over the immediately preceding equal-length window
 * @param deltaCount    {@code current - previous} (always positive for an emitted spike)
 * @param ratio         {@code current / previous} (previous is always {@code >= 1})
 */
public record SpikeComparison(long previousCount, long deltaCount, double ratio) {
}
