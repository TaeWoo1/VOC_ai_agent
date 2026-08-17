package com.sellerops.review.triage.feedback;

/**
 * What the seller did on the way — weighted silver, never a label (feedback draft §7).
 *
 * <p>Three kinds and, deliberately, <b>no {@code IGNORED}</b>. Absence of rows is the record of a
 * review being ignored, and absence is confounded by queue position, staffing, notification timing
 * and lunch. Writing it as an event would give it the shape of a signal it does not have, and
 * §7.2's asymmetry — ignore may lower a silver weight, never a tier — depends on nobody being able to
 * query it as one.
 */
public enum TriageBehaviorKind {
    /** The row was rendered in a list the operator saw. The weakest signal there is. */
    EXPOSED,
    /** The operator opened the review's detail. */
    OPENED,
    /** The operator asked to see the original on the marketplace. */
    ORIGINAL_VIEWED
}
