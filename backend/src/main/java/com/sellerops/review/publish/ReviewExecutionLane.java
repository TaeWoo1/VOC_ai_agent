package com.sellerops.review.publish;

/** Which of the two execution lanes a {@link ReviewReplyExecution} row belongs to. */
public enum ReviewExecutionLane {
    /** reviewnary posted the approved body itself (Cafe24 board comment). */
    API,
    /** The collector filled the seller-center composer; the seller submitted. */
    GUIDED
}
