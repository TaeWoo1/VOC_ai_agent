package com.sellerops.review.triage.feedback;

/**
 * Whether the seller's correction currently stands.
 *
 * <p>Two values, and the second is why {@code review_triage_corrections} is no longer deleted from.
 * A withdrawal that removed the row would cascade into {@link CorrectionDisposition} and could take a
 * row out of a <b>frozen</b> evaluation snapshot — the exact thing that spine exists to make
 * impossible ("an evaluation set that changes under a metric makes the metric meaningless"). So the
 * row stays and its state changes.
 *
 * <p>The same shape as {@code ReviewReplyApprovalState}'s APPROVED/WITHDRAWN, for the same reason:
 * a person can take back a decision, and a product that can only record decisions being made records
 * a history that never happened.
 */
public enum SellerCorrectionState {

    /** The seller's word for this review. The ONLY state a read path may act on. */
    STANDING,

    /** Taken back. The review reads as the system's judgment alone; the trail keeps what was said. */
    WITHDRAWN
}
