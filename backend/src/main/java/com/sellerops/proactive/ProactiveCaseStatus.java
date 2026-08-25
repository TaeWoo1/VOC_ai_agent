package com.sellerops.proactive;

/**
 * Where a proactive case stands — <b>derived from its subject, never commanded</b>.
 *
 * <p>{@link com.sellerops.proactive.ProactiveCaseReconciler} recomputes this on every tick from the
 * work item's phase, the inquiry's operational state, and the review's reply state. No seller action
 * transitions a case directly, and there is no API that sets it. That is the whole reason this is a
 * projection of existing operational truth rather than a second work queue: if the case and the work
 * item ever disagreed, the work item is right, and re-running the reconciler is the repair.
 */
public enum ProactiveCaseStatus {

    /** Investigated, prepared, and waiting for the seller. The only status the list surface shows. */
    PREPARED,

    /**
     * The seller acted on it — the work item moved past PROPOSED, or the review acquired a seller
     * decision. Terminal here; what happened next lives on the existing audit trail.
     */
    ACTED,

    /**
     * No longer actionable, and the seller never acted: the source state changed underneath it, the
     * inquiry was answered on the channel, it was dismissed, or the review stopped needing attention.
     * {@code close_reason} says which. Terminal.
     *
     * <p>This is the status that keeps "seller에게 이미 끝난 일을 다시 보여주지 마" true.
     */
    CLOSED
}
