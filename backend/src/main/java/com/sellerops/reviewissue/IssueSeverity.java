package com.sellerops.reviewissue;

/**
 * How operationally bad a problem is. A fixed property of the problem vocabulary
 * ({@link IssueVocabulary#severityOf}), never derived from the star rating — rating-derived
 * severity is the current analyzer's known blind spot, recorded in
 * {@code contracts/review-eval/naver/v1/RUBRIC.md} §6.
 */
public enum IssueSeverity {

    /** The customer did not receive a usable product. */
    HIGH(0),
    /** The product works but is degrading, wrong, or late. */
    NORMAL(1),
    /** Friction, not failure. */
    LOW(2);

    private final int rank;

    IssueSeverity(int rank) {
        this.rank = rank;
    }

    /** Display/priority order, HIGH first. Uses an explicit rank so enum order is not load-bearing. */
    public int rank() {
        return rank;
    }
}
