package com.sellerops.producttruth;

/**
 * Whether a human has confirmed this row since it was drafted.
 *
 * <p>The point of the whole ledger: a fact that only a program has ever asserted is not yet a
 * product decision. Rows start {@link #TODO_REVIEW} and a person moves them.
 */
public enum ProductReviewState {
    TODO_REVIEW,
    HUMAN_REVIEWED,
}
