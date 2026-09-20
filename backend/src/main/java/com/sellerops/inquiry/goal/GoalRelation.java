package com.sellerops.inquiry.goal;

/**
 * <b>A relationship between two goals that the customer said out loud</b> (Inquiry v3.5 §F).
 *
 * <p>One row of the frozen gold says, in one message: <i>"send just the nozzle; returns are a hassle; if sending only
 * the nozzle is impossible, refund me."</i> Represented as two independent {@link RequestedOutcome#ACTION} goals, that
 * message loses the only thing that makes it safe to act on — that the refund is <b>conditional on the first request
 * failing</b>. A runtime holding two equal action goals may reasonably do either, and doing the second one first is
 * Wrong Automation performed on the customer's own words.
 *
 * <p>So the relationship is preserved, and <b>only</b> the relationship:
 *
 * <pre>
 *   relation := { FALLBACK, primaryGoalId, fallbackGoalId, statedCondition }
 * </pre>
 *
 * <h2>Why this is not the planner coming back</h2>
 *
 * <p>The Resolution Planner was withdrawn for composing a future workflow. This record cannot compose one, and the
 * reasons are structural rather than instructional:
 *
 * <ul>
 *   <li><b>There is one kind</b>, {@link Kind#FALLBACK}, and it is a thing customers say. There is no SEQUENCE, no
 *       DEPENDS_ON, no PREREQUISITE and no THEN — an execution order between goals is not expressible here at all.</li>
 *   <li><b>{@link #statedCondition} is mandatory and is the customer's own words.</b> A model that wants to relate two
 *       goals must quote the clause that relates them. Two action goals from a message with no conditional clause
 *       cannot be related, because there is nothing to put in the field and blank is refused.</li>
 *   <li><b>It relates goals, never capabilities.</b> There is no slot for a resolver, an authority, a capability, a
 *       gap reason or a step, so a resolver-level prerequisite — the one legal form of chaining, named by a resolver
 *       <i>after</i> running — cannot be smuggled in as a customer-stated relation.</li>
 *   <li><b>Nothing in the resolution loop reads it.</b> {@link ResolutionPolicy} takes a {@link CustomerGoal} and
 *       observations; it has no parameter that could carry a relation, and a structural test says so.</li>
 * </ul>
 *
 * <h2>What a FALLBACK does not mean</h2>
 *
 * <p><b>It is not a trigger.</b> The customer's condition is "if the nozzle cannot be sent" — a statement about the
 * business outcome of the first request. {@link com.sellerops.inquiry.authority.ResolutionState#CAPABILITY_GAP} says
 * something entirely different: that this deployment could not even attempt it. Treating the second as the first would
 * refund a customer because a connector is missing. {@link GoalSetResolution} is where that line is held, and it holds
 * it by never activating a fallback at all.
 *
 * @param primaryGoalId   the goal the customer asked for first
 * @param fallbackGoalId  the goal the customer asked for only if the first one cannot happen
 * @param statedCondition the customer's own words for the condition — evidence, not a restatement
 */
public record GoalRelation(Kind kind, String primaryGoalId, String fallbackGoalId, String statedCondition) {

    /** A condition is a clause the customer wrote, not a paragraph and not a rule. */
    public static final int MAX_CONDITION = 60;

    /**
     * The only relationship this contract can express. It is deliberately a single value: every candidate that was
     * considered beside it — ordering, dependency, grouping — describes how work should be carried out, which is the
     * question the planner got wrong and which no customer sentence answers.
     */
    public enum Kind { FALLBACK }

    public GoalRelation {
        if (kind == null) {
            throw new IllegalArgumentException("a relation names its kind");
        }
        if (primaryGoalId == null || primaryGoalId.isBlank() || fallbackGoalId == null || fallbackGoalId.isBlank()) {
            throw new IllegalArgumentException("a relation names both goals");
        }
        if (primaryGoalId.equals(fallbackGoalId)) {
            throw new IllegalArgumentException("a goal is not its own fallback");
        }
        if (statedCondition == null || statedCondition.isBlank()) {
            // The whole fence. Without the customer's clause there is no evidence a relationship was stated, and an
            // unevidenced relationship is exactly the invented fallback this contract exists to make impossible.
            throw new IllegalArgumentException("a relation quotes the condition the customer stated");
        }
        if (statedCondition.length() > MAX_CONDITION) {
            throw new IllegalArgumentException("a stated condition is a clause, not a plan: " + statedCondition.length());
        }
    }

    public static GoalRelation fallback(String primaryGoalId, String fallbackGoalId, String statedCondition) {
        return new GoalRelation(Kind.FALLBACK, primaryGoalId, fallbackGoalId, statedCondition);
    }
}
