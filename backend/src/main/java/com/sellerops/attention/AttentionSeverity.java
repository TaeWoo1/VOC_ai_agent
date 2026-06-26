package com.sellerops.attention;

/**
 * Operator triage severity. Carries an <b>explicit</b> {@link #rank()} (lower = more
 * urgent) so signal sorting never depends on the enum's declaration order — a future
 * reorder or inserted value can't silently change ranking.
 */
public enum AttentionSeverity {
    HIGH(0),
    MEDIUM(1),
    LOW(2);

    private final int rank;

    AttentionSeverity(int rank) {
        this.rank = rank;
    }

    /** Triage rank, lower = more urgent. Independent of {@code ordinal()}. */
    public int rank() {
        return rank;
    }
}
