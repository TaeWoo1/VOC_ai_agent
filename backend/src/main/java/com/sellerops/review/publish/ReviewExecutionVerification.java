package com.sellerops.review.publish;

/**
 * What reviewnary could CONFIRM about an executed review reply — the closed vocabulary the runtime
 * contract names, ordered from proven to merely observed.
 *
 * <p><b>{@code VERIFIED} is reachable on the API lane only.</b> A Cafe24 comment can be read back and
 * its content hash compared to the approved draft. A NAVER reply cannot: the export carries no reply
 * body, so the guided lane's ceiling is {@link #SUBMISSION_OBSERVED_CONTENT_UNVERIFIED} — a later
 * channel read says a reply exists, and nothing says it is the approved text. That is why
 * {@link #memoryEligible()} is true for exactly one value: Answer Memory may learn what the seller
 * actually said, and only a hash match proves what that was.
 */
public enum ReviewExecutionVerification {
    /** The posted comment exists, is the shop's, and hashes to the approved draft. */
    VERIFIED,
    /** A shop comment exists on the target but none hashes to the approved draft. */
    STATUS_UNRESOLVED,
    /** No shop comment could be found on the target. Not a proof of absence; a reason not to POST again. */
    DELIVERY_UNKNOWN,
    /** The read-back itself failed; nothing was proven or disproven. */
    UNVERIFIABLE,
    /** Guided: the composer holds the approved body; the seller has not submitted. */
    COMPOSER_FILLED,
    /** Guided: the seller's submit was observed by the collector. The seller may have edited first. */
    SELLER_SUBMISSION_OBSERVED,
    /** Guided: a later channel read shows a reply on this review. Content unknown. */
    SUBMISSION_OBSERVED_CONTENT_UNVERIFIED;

    /** The guided lane's observation order; {@code -1} for API-lane values, which are not a sequence. */
    public int guidedRank() {
        return switch (this) {
            case COMPOSER_FILLED -> 1;
            case SELLER_SUBMISSION_OBSERVED -> 2;
            case SUBMISSION_OBSERVED_CONTENT_UNVERIFIED -> 3;
            default -> -1;
        };
    }

    /** Whether Answer Memory may read a reply carrying this verification. True for VERIFIED alone. */
    public boolean memoryEligible() {
        return this == VERIFIED;
    }
}
