package com.sellerops.attention;

/**
 * Operator triage severity. Declared most-urgent first so {@code ordinal()} ranks
 * HIGH → MEDIUM → LOW, which the rules use to sort a summary's signals.
 */
public enum AttentionSeverity {
    HIGH,
    MEDIUM,
    LOW
}
