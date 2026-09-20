package com.sellerops.inquiry.goal;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * <b>Everything one customer message asked for</b> (Inquiry v3.5 §F): the goals, and the relationships between them
 * that the customer stated.
 *
 * <p>Until this type existed, a message carrying two alternatives could only be represented as two goals side by side,
 * and "refund me only if you cannot send the nozzle" arrived as "send the nozzle" and "refund me" with equal standing.
 * The set is the smallest thing that keeps the difference.
 *
 * <p><b>Most messages have no relations at all</b> and the list is empty; four of the frozen gold's messages carry
 * several goals and exactly one carries a relation. An empty relation list is the ordinary case and means what it
 * says: the customer named several things and did not rank them.
 *
 * <h2>What the shape refuses</h2>
 *
 * <ul>
 *   <li><b>A goal has at most one fallback, and is the fallback of at most one goal.</b> The result is a forest of
 *       chains, never a graph. A customer who said one conditional sentence produced one edge; a model producing a
 *       second edge from the same goal has invented a second ranking nobody wrote.</li>
 *   <li><b>No cycles.</b> "A if not B, B if not A" is not a thing a customer can mean, and a loop here would be a
 *       runtime that never settles.</li>
 *   <li><b>Every relation names goals that are in this set.</b> A relation reaching outside the message is a relation
 *       about work that is not in front of us.</li>
 * </ul>
 *
 * <p>None of this makes the set an execution plan, because there is no edge type that means "next". See
 * {@link GoalRelation} for why, and {@link GoalSetResolution} for what the runtime is allowed to do with an edge —
 * which, today, is to refuse to act on the fallback at all.
 */
public record CustomerGoalSet(List<CustomerGoal> goals, List<GoalRelation> relations) {

    public CustomerGoalSet {
        goals = goals == null ? List.of() : List.copyOf(goals);
        relations = relations == null ? List.of() : List.copyOf(relations);
        if (goals.isEmpty() && !relations.isEmpty()) {
            throw new IllegalArgumentException("a relation without goals relates nothing");
        }
        Map<String, CustomerGoal> byId = new LinkedHashMap<>();
        for (CustomerGoal g : goals) {
            if (byId.put(g.id(), g) != null) {
                throw new IllegalArgumentException("two goals share the id " + g.id());
            }
        }
        Set<String> primaries = new HashSet<>();
        Set<String> fallbacks = new HashSet<>();
        for (GoalRelation r : relations) {
            if (!byId.containsKey(r.primaryGoalId()) || !byId.containsKey(r.fallbackGoalId())) {
                throw new IllegalArgumentException("a relation names a goal this message does not carry");
            }
            if (!primaries.add(r.primaryGoalId())) {
                throw new IllegalArgumentException("one goal cannot have two fallbacks: " + r.primaryGoalId());
            }
            if (!fallbacks.add(r.fallbackGoalId())) {
                throw new IllegalArgumentException("one goal cannot be two goals' fallback: " + r.fallbackGoalId());
            }
        }
        for (GoalRelation r : relations) {
            String at = r.fallbackGoalId();
            for (int hop = 0; hop <= relations.size(); hop++) {
                String next = null;
                for (GoalRelation s : relations) {
                    if (s.primaryGoalId().equals(at)) {
                        next = s.fallbackGoalId();
                        break;
                    }
                }
                if (next == null) {
                    break;
                }
                if (next.equals(r.primaryGoalId())) {
                    throw new IllegalArgumentException("a fallback chain cannot return to its primary");
                }
                at = next;
            }
        }
    }

    /** One goal, no relations — the shape all but one row of the frozen gold has. */
    public static CustomerGoalSet of(CustomerGoal... goals) {
        return new CustomerGoalSet(List.of(goals), List.of());
    }

    public CustomerGoal byId(String id) {
        for (CustomerGoal g : goals) {
            if (g.id().equals(id)) {
                return g;
            }
        }
        return null;
    }

    /** The relation this goal is the fallback of, or null. The only question the runtime asks of the relations. */
    public GoalRelation conditionOn(String goalId) {
        for (GoalRelation r : relations) {
            if (r.fallbackGoalId().equals(goalId)) {
                return r;
            }
        }
        return null;
    }

    /** The goals that are nobody's fallback: the ones the customer asked for unconditionally. */
    public List<CustomerGoal> unconditional() {
        List<CustomerGoal> out = new ArrayList<>();
        for (CustomerGoal g : goals) {
            if (conditionOn(g.id()) == null) {
                out.add(g);
            }
        }
        return List.copyOf(out);
    }
}
