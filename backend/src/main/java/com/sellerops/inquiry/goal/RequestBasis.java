package com.sellerops.inquiry.goal;

/**
 * <b>On what evidence this goal is attributed to the customer</b> (Inquiry v3.5).
 *
 * <p>The interpreter's one invariant is that it extracts only what the customer asked for. Enforcing that needs a way
 * to tell a goal the customer <i>stated</i> from one a reader <i>worked out</i> — otherwise "invented goal" is
 * indistinguishable from "the designer read it differently", and the headline metric of the new evaluation
 * ({@code INVENTED GOAL RATE}) cannot be measured at all.
 *
 * <p><b>There is no third value, and that is the point.</b> A message whose outcome is neither stated nor directly
 * implied produces <b>no goal</b>: absence is the third state, and it is observable as a count of zero. A
 * {@code Goal(basis = UNSTATED)} would be a goal the interpreter invented while labelling it invented, which is worse
 * than not emitting it.
 *
 * <p>The frozen gold contains five goals that exist only by inference — a customer describing a broken item, a wrong
 * quantity, a wish to receive something sooner, with no outcome named. The plan representation could not show that,
 * because a plan has no place to say "this goal was added by the reader". Those five are listed in
 * {@code docs/inquiry_architecture_v35.md} §4 class A.
 */
public enum RequestBasis {

    /** The customer named the outcome: a question asked, a request made. */
    STATED,

    /**
     * The customer named a situation whose outcome follows from it without a further assumption about what they want —
     * "how do I stop it falling off" behind "it keeps falling off".
     *
     * <p>A goal on this basis still answers to the invariant: the test is whether the outcome follows from what was
     * said, not whether it is the outcome the seller would prefer to answer.
     */
    DIRECTLY_IMPLIED
}
