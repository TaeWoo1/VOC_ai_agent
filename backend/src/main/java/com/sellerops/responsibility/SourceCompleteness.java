package com.sellerops.responsibility;

/**
 * How far one source was observed (docs/responsibility_runtime_v1.md §6-2).
 *
 * <p>The distinction this enum exists for: {@link #COMPLETE} with {@code observedCount = 0} is «확인했고 새로 없음»,
 * and {@link #NONE} is «확인하지 못함» and carries no count at all (the schema refuses one).
 */
public enum SourceCompleteness {
    /** The read reached the end of what the source offered for this collection. A 0 here is a real zero. */
    COMPLETE,
    /** The read stopped at an explicit, recorded bound. Its count is the count of THIS read, never the source total. */
    BOUNDED,
    /** The read started and did not finish. Its count is what arrived before it stopped. */
    PARTIAL,
    /** The source was not observed. No count exists. */
    NONE;

    /** Settled sources are not re-executed by a retry of the same run. */
    public boolean settled() {
        return this == COMPLETE || this == BOUNDED;
    }
}
