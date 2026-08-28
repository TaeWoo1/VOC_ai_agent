package com.sellerops.review.publish;

/**
 * What reviewnary DID — one closed word per {@link ReviewReplyExecution} row. Separate from
 * {@link ReviewExecutionVerification}, which is what it could CONFIRM afterwards.
 */
public enum ReviewExecutionStatus {
    /** The channel accepted the one POST (API lane). */
    POSTED,
    /** Nothing was sent: a gate refused before a byte left, or the channel refused the body. */
    REFUSED,
    /** The request may or may not have arrived; there was no second attempt (API lane). */
    DELIVERY_UNKNOWN,
    /** The approved body was placed into the seller-center composer (guided lane). */
    COMPOSER_FILLED,
    /** The collector saw the seller press submit (guided lane). Not a claim about the channel. */
    SELLER_SUBMISSION_OBSERVED;

    public boolean guided() {
        return this == COMPOSER_FILLED || this == SELLER_SUBMISSION_OBSERVED;
    }
}
