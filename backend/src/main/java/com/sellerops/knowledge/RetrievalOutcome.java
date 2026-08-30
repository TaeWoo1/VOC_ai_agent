package com.sellerops.knowledge;

/**
 * What one retrieval actually established — four different facts that used to collapse into one
 * empty list (Retrieval &amp; Grounding Correctness v1, 2026-08-30).
 *
 * <p>The seller acts differently on each, which is why the distinction has to survive to the
 * sentence: an {@link #ABSENT} corpus is fixed by writing the first note; {@link #NO_RELEVANT_EVIDENCE}
 * is fixed by writing the missing one; {@link #NOT_APPLICABLE} is not fixed by writing anything — the
 * rule exists and does not apply to this question, and telling the seller to register it again is
 * how duplicate policies get made.
 */
public enum RetrievalOutcome {

    /** At least one passage cleared the lexical gates AND the applicability gate. */
    FOUND,

    /** There is nothing to search: no document for this org / product / scope. */
    ABSENT,

    /** Documents exist; no passage covered this question through any query candidate. */
    NO_RELEVANT_EVIDENCE,

    /**
     * Passages matched lexically but every one was rejected by the applicability gate — the
     * question is about one topic and the passage's document is declared about another.
     */
    NOT_APPLICABLE;

    /** Whether the corpus had something to say, applicable or not. */
    public boolean corpusExists() {
        return this != ABSENT;
    }

    /**
     * The more informative of two outcomes for the same question — the order a caller reports in
     * when several candidates were tried: a hit beats a rejection beats a miss beats an empty corpus.
     */
    public RetrievalOutcome strongest(RetrievalOutcome other) {
        return other == null || rank() >= other.rank() ? this : other;
    }

    private int rank() {
        return switch (this) {
            case FOUND -> 3;
            case NOT_APPLICABLE -> 2;
            case NO_RELEVANT_EVIDENCE -> 1;
            case ABSENT -> 0;
        };
    }
}
