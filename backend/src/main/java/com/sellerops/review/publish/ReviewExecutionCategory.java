package com.sellerops.review.publish;

/** The seller-facing reading of one execution row, derived — never stored. */
public enum ReviewExecutionCategory {
    COMPLETED,
    CHECKING_REQUIRED,
    RETRYABLE_FAILURE,
    PERMANENT_FAILURE,
    /** Guided lane: the next move is the seller's, or the channel has not been re-read yet. */
    SELLER_ACTION;

    public static ReviewExecutionCategory of(ReviewExecutionStatus status, ReviewExecutionVerification verification,
                                             ReviewExecutionReason reason) {
        return switch (status) {
            case POSTED -> verification == ReviewExecutionVerification.VERIFIED ? COMPLETED : CHECKING_REQUIRED;
            case DELIVERY_UNKNOWN -> CHECKING_REQUIRED;
            case REFUSED -> reason == null || reason.retryable() ? RETRYABLE_FAILURE : PERMANENT_FAILURE;
            case COMPOSER_FILLED, SELLER_SUBMISSION_OBSERVED -> SELLER_ACTION;
        };
    }
}
