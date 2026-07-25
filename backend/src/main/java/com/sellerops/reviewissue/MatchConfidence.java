package com.sellerops.reviewissue;

/**
 * How a piece of evidence reached its issue. Stored on
 * {@code review_issue_evidence.match_confidence}.
 *
 * <p>Only {@link #EXACT_SIGNATURE} exists while the extractor is deterministic, so the column looks
 * redundant today. It is not: the pipeline's design has a verification step whose whole purpose is
 * that a <i>similar</i> match must be distinguishable from an <i>identical</i> one, and a column
 * added later cannot describe rows written earlier. Storing it from the start means a future
 * similarity match can never be silently read as certainty.
 */
public enum MatchConfidence {

    /** The unit's signature key equalled the issue's. No judgement involved. */
    EXACT_SIGNATURE
}
