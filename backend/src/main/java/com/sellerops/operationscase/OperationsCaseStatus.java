package com.sellerops.operationscase;

/**
 * Where a case stands — derived by {@link OperationsCaseReconciler} from canonical truth, never commanded.
 *
 * <p>The names are the proactive table's own on purpose: {@code uq_proactive_case_open_subject} is a partial index
 * {@code where status = 'PREPARED'}, and keeping «open» spelled the same way is what lets that one index guarantee
 * one open card per subject across both producers.
 */
public enum OperationsCaseStatus {
    /** Open: waiting for the seller, or being watched by Reviewnary. */
    PREPARED,
    /** The canonical record shows the seller acted (the work item moved on, the review was decided or answered). */
    ACTED,
    /** No longer open, and not because of a seller action this case can see. {@code resolution_reason} says why. */
    CLOSED
}
