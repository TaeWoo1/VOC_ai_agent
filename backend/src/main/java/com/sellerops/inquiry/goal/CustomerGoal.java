package com.sellerops.inquiry.goal;

import java.util.List;

/**
 * <b>One outcome this customer asked this message to produce</b> (Inquiry v3.5).
 *
 * <p>This record replaces the Resolution Planner as the only thing an LLM produces in the inquiry path. It is
 * deliberately much smaller than a plan, and the smallness is the design: a plan asked one model call to decide the
 * customer's meaning <i>and</i> the whole future workflow that would satisfy it, and five separate measured failures
 * turned out to be the same failure — reading more entity fields than the question needed, asking for more customer
 * input than the answer depended on, adding a procedure nobody requested, appending a seller like insurance, and
 * fixing a search scope before looking. A component that cannot say any of those things cannot get them wrong.
 *
 * <h2>What it may say</h2>
 * <pre>
 *   goal := { id, explicitRequest, requestedOutcome, subject, basis, explicitConstraints[] }
 * </pre>
 *
 * <h2>What it may not say — and why that is a shape and not a rule</h2>
 *
 * <p>There is no field here for required entity fields, customer inputs to ask, a capability sequence, a procedure, a
 * fallback, a handoff, a closing authority, availability, an execution effect, or a future possible action. Each of
 * those belongs to a resolver or to the registry, and each was a measured failure when the model owned it. They are
 * absent rather than validated-against: a rule can be satisfied on the wire and still be wrong in spirit, whereas a
 * record with no slot for a procedure <b>cannot carry one</b>.
 *
 * <p><b>The invariant.</b> Only what the customer explicitly or directly requested. A goal is never added because it
 * might be needed later: asked whether an exchange can be approved, this contract produces one {@link
 * RequestedOutcome#DECISION} and no {@link RequestedOutcome#ACTION}. Whether the seller, having decided, then wants to
 * run the exchange is the seller's next request and not this customer's current one. {@link RequestBasis} records
 * which of "explicitly" or "directly" applies, so a goal nobody asked for is countable rather than arguable.
 *
 * <p><b>Several goals are ordinary.</b> A message that asks three things carries three goals; the frozen gold has four
 * such messages. What is not ordinary is a goal with no sentence behind it.
 */
public record CustomerGoal(String id, String explicitRequest, RequestedOutcome requestedOutcome, Referent subject,
                           RequestBasis basis, List<String> explicitConstraints) {

    /** Long enough for a request in the customer's own words, short enough that a plan cannot hide in it. */
    public static final int MAX_REQUEST = 140;

    /** One constraint is a value, not a sentence. */
    public static final int MAX_CONSTRAINT = 40;

    /**
     * @param explicitRequest    what this customer asked for, in the customer's terms — never a restatement that adds
     *                           a prerequisite they did not mention
     * @param explicitConstraints only values the customer actually said. A value the model inferred is not a
     *                            constraint: it is a guess the resolver would then treat as given
     */
    public CustomerGoal {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("a goal is identified");
        }
        if (explicitRequest == null || explicitRequest.isBlank()) {
            throw new IllegalArgumentException("a goal carries the request it came from");
        }
        if (explicitRequest.length() > MAX_REQUEST) {
            throw new IllegalArgumentException("an explicit request is a request, not a plan");
        }
        if (requestedOutcome == null) {
            throw new IllegalArgumentException("a goal names the kind of outcome requested");
        }
        if (subject == null) {
            throw new IllegalArgumentException("a goal names what it is about, or names that it could not be resolved");
        }
        if (basis == null) {
            throw new IllegalArgumentException("a goal records whether it was stated or implied");
        }
        explicitConstraints = explicitConstraints == null ? List.of() : List.copyOf(explicitConstraints);
        for (String c : explicitConstraints) {
            if (c == null || c.isBlank()) {
                throw new IllegalArgumentException("a constraint is a value the customer said");
            }
            if (c.length() > MAX_CONSTRAINT) {
                throw new IllegalArgumentException("a constraint is a value, not a sentence: " + c.length());
            }
        }
    }

    /**
     * Whether any resolver of the outcome's first authority can act on this subject at all. <b>Asked of the registry
     * before dispatch</b>, so that "this deployment cannot do this here" is decided by the registry and never by the
     * interpreter changing what the customer meant.
     */
    public boolean actionable() {
        return subject.bound() && ReferentRegistry.canAct(requestedOutcome.firstResolver(), subject);
    }
}
