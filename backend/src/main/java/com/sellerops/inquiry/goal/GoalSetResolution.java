package com.sellerops.inquiry.goal;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * <b>Resolving a message that carries a customer-stated fallback</b> (Inquiry v3.5 §F).
 *
 * <p>The loop in {@link GoalResolution} resolves one goal. This resolves a {@link CustomerGoalSet}, and the only thing
 * it adds is a refusal: <b>a goal the customer made conditional is not attempted</b>. It is carried to the seller with
 * the customer's own condition attached, and nothing in this runtime can move it.
 *
 * <h2>Why nothing activates it</h2>
 *
 * <p>Activating "refund me" requires knowing that "send just the nozzle" <b>will not happen</b> — a business outcome.
 * Enumerate what this runtime can actually end a goal with:
 *
 * <ul>
 *   <li>{@code RESOLVED} / {@code RESOLVED_CONDITIONAL} — an answer was produced. Not a refusal.</li>
 *   <li>{@code NEEDS_CUSTOMER_INPUT} — we are waiting on the customer. Not a refusal.</li>
 *   <li>{@code NEEDS_SELLER} — nobody has written down whether it is possible. <b>The opposite of knowing.</b></li>
 *   <li>{@code CAPABILITY_GAP} — this deployment could not attempt it: no executor, no connector field, nothing
 *       bound. It says what <i>we</i> cannot do and says nothing at all about what the seller will do.</li>
 *   <li>{@code FAILED} — something upstream broke.</li>
 * </ul>
 *
 * <p>Not one of them is "the seller considered this and refused". <b>There is no producer of that fact in this
 * system</b>, and so there is no condition under which a fallback may fire. The dangerous reading is the fourth one:
 * every procedure in this registry is {@code DECLARED_NO_EXECUTOR}, so <i>every</i> action goal ends at
 * {@code CAPABILITY_GAP}, and a runtime that treated a gap as impossibility would refund every customer who ever
 * wrote a conditional sentence — on the strength of a missing integration.
 *
 * <p>So the disposition is not "activate later, once we are cleverer". It is
 * {@link Disposition#WITHHELD_FOR_CUSTOMER_STATED_CONDITION}, for every terminal state of the primary and every gap
 * reason there is, asserted exhaustively rather than argued. When a producer of an authoritative refusal exists, it
 * will be a new observation with its own evidence, and this is the one place that would have to change.
 */
public final class GoalSetResolution {

    private GoalSetResolution() {
    }

    /** What happened to one goal of the set. */
    public enum Disposition {
        /** Resolved on its own merits, by the ordinary loop. */
        RESOLVED_INDEPENDENTLY,
        /**
         * Not attempted, because the customer said to do it only if something else could not be done, and no
         * observation in this runtime establishes that. The goal is not lost and it is not done: it is handed over
         * with the condition the customer wrote.
         */
        WITHHELD_FOR_CUSTOMER_STATED_CONDITION
    }

    /**
     * @param trace     the resolution, or null when the goal was withheld — a withheld goal has no trace because no
     *                  resolver was asked, which is the point
     * @param condition the customer's clause, present exactly when the goal was withheld
     */
    public record Entry(String goalId, Disposition disposition, GoalResolution.Trace trace, GoalRelation condition) {
        public Entry {
            if (goalId == null || goalId.isBlank()) {
                throw new IllegalArgumentException("an entry names its goal");
            }
            boolean withheld = disposition == Disposition.WITHHELD_FOR_CUSTOMER_STATED_CONDITION;
            if (withheld != (condition != null)) {
                throw new IllegalArgumentException("a condition is recorded exactly for a withheld goal");
            }
            if (withheld == (trace != null)) {
                throw new IllegalArgumentException("a withheld goal has no trace, and a resolved one has one");
            }
        }
    }

    public record Outcome(CustomerGoalSet set, List<Entry> entries) {
        public Outcome {
            entries = entries == null ? List.of() : List.copyOf(entries);
        }

        public Entry of(String goalId) {
            for (Entry e : entries) {
                if (e.goalId().equals(goalId)) {
                    return e;
                }
            }
            return null;
        }

        public List<Entry> withheld() {
            List<Entry> out = new ArrayList<>();
            for (Entry e : entries) {
                if (e.disposition() == Disposition.WITHHELD_FOR_CUSTOMER_STATED_CONDITION) {
                    out.add(e);
                }
            }
            return List.copyOf(out);
        }
    }

    /**
     * Resolve every unconditional goal in order, and withhold every conditional one. The resolver function is the
     * same one {@link GoalResolution#run} takes, and it is <b>never called for a withheld goal</b> — the refusal is
     * that no resolver is asked, not that its answer is discarded.
     */
    public static Outcome run(CustomerGoalSet set, Function<ResolutionPolicy.Run, ResolverOutcome> resolver) {
        if (resolver == null) {
            throw new IllegalArgumentException("a set and a resolver");
        }
        return run(set, (goal, run) -> resolver.apply(run));
    }

    /**
     * The same walk, for a resolver that needs to know <b>which goal</b> it is answering about.
     *
     * <p>A {@link ResolutionPolicy.Run} names an authority and a capability and deliberately carries no goal:
     * dispatch is a function of the outcome kind alone, and that is the property §25 relies on. A resolver reading
     * real objects needs more than that — the subject is what decides which listing is being asked about. Rather
     * than let a caller capture one goal in a closure and then hand that same closure to every goal in the set,
     * which is a defect waiting for the second goal, the goal is passed in.
     *
     * <p>{@link #run(CustomerGoalSet, Function)} delegates here, so there is one walk and one rule about what a
     * withheld goal means.
     */
    public static Outcome run(CustomerGoalSet set,
                              java.util.function.BiFunction<CustomerGoal, ResolutionPolicy.Run, ResolverOutcome>
                                      resolver) {
        if (set == null || resolver == null) {
            throw new IllegalArgumentException("a set and a resolver");
        }
        List<Entry> entries = new ArrayList<>();
        for (CustomerGoal goal : set.goals()) {
            GoalRelation condition = set.conditionOn(goal.id());
            if (condition != null) {
                entries.add(new Entry(goal.id(), Disposition.WITHHELD_FOR_CUSTOMER_STATED_CONDITION, null, condition));
                continue;
            }
            entries.add(new Entry(goal.id(), Disposition.RESOLVED_INDEPENDENTLY,
                    GoalResolution.run(goal, run -> resolver.apply(goal, run)), null));
        }
        return new Outcome(set, List.copyOf(entries));
    }
}
