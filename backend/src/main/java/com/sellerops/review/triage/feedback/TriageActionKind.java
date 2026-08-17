package com.sellerops.review.triage.feedback;

/**
 * What the seller did about a review. Explicit — each one is a control the operator pressed.
 *
 * <p>{@code COMPLETED} is the strongest evidence this spine has that a review was actionable: someone
 * decided something had to be done and did it (feedback draft §7.2). {@code NOT_NEEDED} is the
 * explicit form of "nothing to do here" — the ONLY form. Being passed over is not recorded as an
 * action, because being passed over is what happens to everything in a queue nobody worked that day.
 */
public enum TriageActionKind {
    STARTED,
    COMPLETED,
    NOT_NEEDED
}
