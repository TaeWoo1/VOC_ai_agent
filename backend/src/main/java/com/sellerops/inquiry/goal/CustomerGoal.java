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
 *   goal := { id, explicitRequest, requestedOutcome, subject, basis, explicitConstraints[], evidence }
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
 * RequestedOutcome#ANSWER} and no {@link RequestedOutcome#ACTION}. Whether the seller, having decided, then wants to
 * run the exchange is the seller's next request and not this customer's current one. {@link RequestBasis} records
 * which of "explicitly" or "directly" applies, so a goal nobody asked for is countable rather than arguable.
 *
 * <p><b>Several goals are ordinary.</b> A message that asks three things carries three goals; the frozen gold has four
 * such messages. What is not ordinary is a goal with no sentence behind it.
 *
 * <h2>{@link #evidence} — the sentence behind it, made mandatory</h2>
 *
 * <p>That last clause was the contract's own statement of its invariant, and until v2 <b>nothing enforced it</b>. The
 * measured failure: on the fixture message <i>"묶음 상품인 줄 알고 샀는데 한 개만 왔어요"</i> — a customer reporting
 * that one item arrived when they expected a bundle, and requesting nothing — the interpreter emitted the expected
 * {@link RequestedOutcome#ANSWER} goal <i>and</i> an {@link RequestedOutcome#ACTION} goal, "부족한 수량을 처리해
 * 주세요", which no clause of that message asks for. It arrived on {@link RequestBasis#DIRECTLY_IMPLIED}, carrying no
 * constraints, no relation, and an {@code explicitRequest} the model composed. Nothing on the wire was false, because
 * the wire had no field in which a false claim could be made.
 *
 * <p><b>The asymmetry that diagnosis exposed.</b> An invented {@link GoalRelation} is unconstructible: its
 * {@code statedCondition} demands the customer's own clause, and a message with no conditional sentence has nothing
 * to put there. A goal had no equivalent field, so {@code basis} was an unbacked assertion — and
 * {@code DIRECTLY_IMPLIED} is by definition the value whose meaning excuses the absence of a quote.
 *
 * <p>So a goal now quotes too. {@code evidence} is the customer's own words this goal rests on, and it is
 * <b>separate from {@code explicitRequest}</b> deliberately: the request is a restatement in the customer's terms and
 * is often not a span of the message ("기한이 지났는데 승인 가능하면 승인해 주시고" restates a question), whereas the
 * evidence is a quote and is verified as one. Making {@code explicitRequest} itself the quote was tried against the
 * committed fixture and refused: it breaks every multi-goal row.
 *
 * <p>The three rules together — and each is measured against the frozen gold's 72 goals in {@link CustomerGoalSet}:
 *
 * <ul>
 *   <li><b>Every goal quotes</b> (here). A goal with no span cannot be built, exactly as a relation with no clause
 *       cannot.</li>
 *   <li><b>Every span is verbatim</b> ({@link CustomerGoalSet#unquoted}). Stronger than the relation fence, which
 *       only refuses blank — the parser holds the customer's message and so can check the quote is a quote. This is
 *       what stops a goal from dodging the inference cap by relabelling itself {@code STATED}.</li>
 *   <li><b>Spans are distinct, and at most one goal is inferred</b> ({@link CustomerGoalSet}).</li>
 * </ul>
 */
public record CustomerGoal(String id, String explicitRequest, RequestedOutcome requestedOutcome, Referent subject,
                           RequestBasis basis, List<String> explicitConstraints, String evidence) {

    /** Long enough for a request in the customer's own words, short enough that a plan cannot hide in it. */
    public static final int MAX_REQUEST = 140;

    /** One constraint is a value, not a sentence. */
    public static final int MAX_CONSTRAINT = 40;

    /**
     * @param explicitRequest    what this customer asked for, in the customer's terms — never a restatement that adds
     *                           a prerequisite they did not mention
     * @param explicitConstraints only values the customer actually said. A value the model inferred is not a
     *                            constraint: it is a guess the resolver would then treat as given
     * @param evidence            the customer's own words this goal rests on — a quote, never a restatement. Bounded
     *                            by {@link #MAX_REQUEST} on the principle that a quote is never longer than the
     *                            request it grounds, which is why this needs no constant of its own
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
        if (evidence == null || evidence.isBlank()) {
            // The goal-side half of the fence GoalRelation has had since §F. Without the customer's own words there
            // is no evidence this outcome was requested, and an unevidenced goal is the invented goal this contract
            // exists to make impossible. Blank is refused here; that the words are really theirs is checked by
            // CustomerGoalSet.unquoted, which is the only place that holds the message.
            throw new IllegalArgumentException("a goal quotes the words the customer asked it in");
        }
        if (evidence.length() > MAX_REQUEST) {
            throw new IllegalArgumentException("evidence is a quote, not a plan: " + evidence.length());
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
