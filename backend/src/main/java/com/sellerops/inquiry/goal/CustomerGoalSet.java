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
 *   <li><b>No two goals quote the same clause</b>, and no quote contains another. A clause has one direct reading;
 *       two goals resting on one clause means the reader read it twice and called the second reading a request.</li>
 *   <li><b>At most one goal is {@link RequestBasis#DIRECTLY_IMPLIED}.</b> See below.</li>
 * </ul>
 *
 * <h2>One inference per message</h2>
 *
 * <p>This cap is what makes the invented-ACTION failure structurally unreachable rather than merely visible. A
 * message that names no outcome directly implies the resolution of the <i>situation it describes</i> — one situation
 * report, one inferred goal. A second inferred goal is the reader choosing a remedy, which is exactly what happened
 * on the fixture message "묶음 상품인 줄 알고 샀는데 한 개만 왔어요": two goals, both {@code DIRECTLY_IMPLIED}, the
 * second an {@link RequestedOutcome#ACTION} nobody asked for.
 *
 * <p><b>It was measured before it was written, not after.</b> Against the frozen real-corpus gold: 72 goals across 66
 * messages, of which 4 are {@code DIRECTLY_IMPLIED} — and each of those 4 is the only goal of its message, so the cap
 * costs <b>0 of 72</b>. All 5 multi-goal gold messages are entirely {@code STATED}. Against the committed synthetic
 * fixture: 0 of 23 rows violate it. Against the recorded 14-call run {@code v35-goal-smoke-07530e82-b3b0a9c5}: it
 * refuses <b>exactly one row, G15</b>, and leaves the other 13 untouched.
 *
 * <p><b>Why {@link RequestBasis#DIRECTLY_IMPLIED} survives at all.</b> Deleting it was the other candidate and the
 * gold refuses it: 4 gold goals exist only by inference and 2 of those are {@code ACTION} ("배송을 빨리 받고싶습니다"
 * names a wanted outcome without an imperative). A contract that could not express them would lose real goals — the
 * over-blocking this cap is bounded to avoid. What distinguishes those 2 from G15's ACTION is that the customer's own
 * words name a wanted outcome; that is a judgement, and {@link CustomerGoal#evidence} is where the model must now
 * commit to it in the customer's words instead of asserting it in a label.
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
        int inferred = 0;
        for (CustomerGoal g : goals) {
            if (g.basis() == RequestBasis.DIRECTLY_IMPLIED && ++inferred > 1) {
                throw new IllegalArgumentException(
                        "a message directly implies one goal; a second inference is the reader choosing a remedy");
            }
        }
        for (int i = 0; i < goals.size(); i++) {
            String a = normalize(goals.get(i).evidence());
            for (int j = i + 1; j < goals.size(); j++) {
                String b = normalize(goals.get(j).evidence());
                if (a.contains(b) || b.contains(a)) {
                    throw new IllegalArgumentException("two goals quote the same clause: " + goals.get(i).id()
                            + " and " + goals.get(j).id());
                }
            }
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

    /**
     * The goals whose {@link CustomerGoal#evidence} is <b>not</b> a span of the message the customer actually sent —
     * empty when every goal quotes, which is the only accepted state.
     *
     * <p>This is the half of the fence the record constructors cannot hold, and it is <b>stronger than the relation
     * fence</b>: {@link GoalRelation} can only refuse a blank condition, because nothing that builds one has the
     * message in hand. Whatever parses a model's answer does, so a goal's quote is checked to be a quote.
     *
     * <p><b>It is what closes the relabelling dodge.</b> With only the inference cap, a model that wanted a second
     * inferred goal could call it {@code STATED} and pass — {@code basis} being an assertion nobody could check. It
     * is checkable now: a {@code STATED} goal must point at the words the customer stated it in, and they must be
     * there.
     *
     * <p>Comparison collapses runs of whitespace and nothing else. Line wrapping is not a claim about what the
     * customer said; punctuation is, so a quote that drops or adds it is not the customer's clause.
     *
     * @param customerMessage the message as sent. A null or blank message can evidence nothing, so every goal fails.
     */
    public List<String> unquoted(String customerMessage) {
        String haystack = normalize(customerMessage);
        List<String> out = new ArrayList<>();
        for (CustomerGoal g : goals) {
            if (haystack.isEmpty() || !haystack.contains(normalize(g.evidence()))) {
                out.add(g.id());
            }
        }
        return List.copyOf(out);
    }

    private static String normalize(String s) {
        return s == null ? "" : s.strip().replaceAll("\\s+", " ");
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
