package com.sellerops.inquiry.goal;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.ResolutionState;
import java.util.List;

/**
 * <b>Which resolver is asked next</b> (Inquiry v3.5) — code and registry, never a model.
 *
 * <p>This replaces the authority sequence the Resolution Planner used to emit. It is a <b>pure function of the goal
 * and what has already been observed</b>, and it returns exactly one next step or a terminal state. It cannot return
 * a sequence, because there is no shape here that holds one: the step after next depends on a result that does not
 * exist yet, and the whole failure being corrected was a model answering that question early.
 *
 * <h2>The dispatch</h2>
 * <table><caption>first resolver by requested outcome</caption>
 *   <tr><td>{@code ANSWER}</td><td>Knowledge</td></tr>
 *   <tr><td>{@code STATE_READ}</td><td>Entity State</td></tr>
 *   <tr><td>{@code ACTION}</td><td>Procedure</td></tr>
 * </table>
 *
 * <h2>The seller is a state, not a step</h2>
 *
 * <p>§10's rule survives the merge of {@code INFORMATION} and {@code DECISION} unchanged, because it never depended
 * on the token: "is this returnable after the window?" is not a seller question because it contains the word decide;
 * it is a seller question only when no written policy decides it. Knowledge is asked first, and human authority is
 * reached from an <b>observed absence</b>, never from the outcome kind. What the merge removed is the belief that
 * reaching it required <b>dispatching</b> anything.
 *
 * <p>The frozen gold settles that. <b>35 of its 72 goals terminate {@link ResolutionState#NEEDS_SELLER}, and 32 of
 * them do so with no {@code SELLER} step in their trace</b>; the seller resolver closes 0 of 72. So the terminal is
 * what carries the meaning — a true statement that this seller's written knowledge does not decide this — and the
 * dispatch was a fourth capability appended to three traces before they ended in exactly the state they would have
 * ended in anyway. Removing it is what keeps the merge from widening the loop: keying the same dispatch on the
 * observed absence instead of the token would have added it to <b>30 more</b> goals and closed none of them.
 *
 * <p>{@link CapabilityId#SELLER} is therefore not dispatched from this loop. It stays in the registry, which is a
 * declaration of what authorities exist and is read by {@link ReferentRegistry} and the older planner layer.
 *
 * <h2>What an ANSWER resolver actually does (§6)</h2>
 *
 * <p>"Knowledge, and the seller if there is none" was too small a description, and the audit of 2026-09-20 measured
 * how much: of the five judgment goals in the frozen gold, <b>three require observed entity state</b>, and two of
 * those carried the entity read in the gold before any of them were re-adjudicated. The corrected account:
 *
 * <p>An {@code ANSWER} resolver looks for the <b>rule or fact that answers this goal</b>. Knowledge is asked first
 * because a rule is a thing the seller wrote down. Having found it, the resolver may discover that applying it needs
 * a fact — whether an address may still be changed depends on whether the order has shipped — and it then names
 * <b>that one capability</b> as a prerequisite. The order read runs, the rule is resumed, and the answer is produced
 * or is found to need a human.
 *
 * <pre>
 *   ANSWER → KNOWLEDGE (find the rule) → [rule names a prerequisite] → ENTITY_STATE → KNOWLEDGE (apply it)
 *          → RESOLVED, or NEEDS_SELLER on an observed absence
 * </pre>
 *
 * <p>Two things this is not. It is not the Customer Goal Interpreter deciding what an answer needs — the interpreter
 * never sees a capability. And it is not a planner: the prerequisite is named by a resolver <b>after it has run</b>,
 * one at a time, with nothing written down about what comes after it.
 *
 * <h2>The waiter/resume state machine</h2>
 *
 * <p>Nine properties, each asserted by {@code ResolutionPolicyInvariantTest} and exercised by a fixture:
 *
 * <ol type="A">
 *   <li>a resolver that names a prerequisite is <b>waiting</b>;</li>
 *   <li>when the prerequisite produces an observation, the waiter is dispatched again;</li>
 *   <li>when the prerequisite gaps, fails, finds nothing or asks the customer something, the waiter is
 *       <b>not</b> resumed and the goal settles in the prerequisite's own state;</li>
 *   <li>a prerequisite succeeding is <b>never</b> the goal being resolved;</li>
 *   <li>the same prerequisite cannot be asked for twice;</li>
 *   <li>a cycle — R1 waits on R2 waits on R1 — ends closed;</li>
 *   <li>the chain is bounded by {@link #MAX_WAIT_DEPTH}, which is the registry's size and not a chosen number;</li>
 *   <li>the resolver resumed is <b>the exact capability that asked</b>, not another of the same authority;</li>
 *   <li>the prerequisite's observation, with its provenance, stays in the trace for the resumed resolver to read.</li>
 * </ol>
 *
 * <h2>Two things this will not do</h2>
 *
 * <p><b>1. It never substitutes an authority for an unavailable one.</b> If the resolver could not run — source
 * unreadable, capability disabled, entity unbound — the goal settles at {@link ResolutionState#CAPABILITY_GAP} with
 * the registry's reason. It does not quietly become a seller judgment. The distinction is exact and it matters:
 *
 * <ul>
 *   <li>the resolver <b>ran and found nothing</b> → {@link ResolutionState#NEEDS_SELLER}. A new judgment is genuinely
 *       required, which is a true statement about this seller's written knowledge.</li>
 *   <li>the resolver <b>could not run</b> → {@link ResolutionState#CAPABILITY_GAP}. We do not know whether a policy
 *       exists, and reporting a seller judgment would be asserting that it does not.</li>
 * </ul>
 *
 * <p><b>2. Only an {@code ACTION} may reach a procedure.</b> Enforced here and asserted by mutation test: a goal that
 * asked whether something is possible cannot, by any path through this function, cause the procedure registry to be
 * consulted. That is the C6 defect expressed as a structure instead of a sentence in a prompt.
 */
public final class ResolutionPolicy {

    /**
     * <b>How deep a chain of waits may go</b> — derived, not chosen.
     *
     * <p>A resolver does not wait on itself ({@link ResolverOutcome}), and a prerequisite that has already run is
     * refused above, so every capability appears in a wait chain at most once. The registry's own size is therefore
     * the only bound the architecture can justify, and it is written as that expression rather than as a number so
     * that registering a capability moves it and nobody has to remember to.
     *
     * <p>It is a second fence rather than the only one: {@link GoalResolution#MAX_STEPS} already stops the loop, and
     * this exists so that an over-deep chain ends by <b>saying which invariant it broke</b> instead of running out of
     * steps and looking like an ordinary timeout.
     */
    public static final int MAX_WAIT_DEPTH = CapabilityId.values().length - 1;

    private ResolutionPolicy() {
    }

    /** One next step, or the end. Sealed: there is no third thing this function can say. */
    public sealed interface Dispatch permits Run, Settle {
    }

    /** Ask this resolver, then come back with what it observed. */
    public record Run(Authority resolver, CapabilityId capability) implements Dispatch {
        public Run {
            if (resolver == null) {
                throw new IllegalArgumentException("a dispatch names the resolver");
            }
            if (capability != null && capability.authority() != resolver) {
                throw new IllegalArgumentException(capability + " is not a " + resolver + " capability");
            }
        }
    }

    /** The goal is finished, in this state. */
    public record Settle(ResolutionState state, GapReason gap) implements Dispatch {
        public Settle {
            if (state == null) {
                throw new IllegalArgumentException("a settlement names its state");
            }
            if ((state == ResolutionState.CAPABILITY_GAP) != (gap != null)) {
                throw new IllegalArgumentException("a gap reason is given exactly for CAPABILITY_GAP");
            }
        }
    }

    /**
     * @param goal     the customer's goal, unchanged for the whole loop
     * @param observed every resolver outcome so far, oldest first — never a prediction of a future one
     */
    public static Dispatch next(CustomerGoal goal, List<ResolverOutcome> observed) {
        if (goal == null || observed == null) {
            throw new IllegalArgumentException("dispatch reads a goal and what has been observed");
        }
        // A referent this deployment cannot identify is a gap, not a reason to resolve against something else.
        if (!goal.subject().bound()) {
            return new Settle(ResolutionState.CAPABILITY_GAP, GapReason.UNBOUND);
        }
        if (observed.isEmpty()) {
            return first(goal);
        }
        ResolverOutcome last = observed.get(observed.size() - 1);

        // (A) The only chaining there is: the resolver that just ran named what must run before it can continue.
        if (last.prerequisite() != null) {
            // (E, F) A request for something already served is a repeat; a request for something already in the chain
            // closes a cycle. Both reduce to the same observation — this capability has run — so R1 waiting on R2
            // waiting on R1 ends on the second request instead of spinning.
            if (alreadyRan(observed, last.prerequisite())) {
                return new Settle(ResolutionState.FAILED, null);
            }
            // (G) Bounded by the registry rather than by a number anyone chose.
            if (openWaits(observed) > MAX_WAIT_DEPTH) {
                return new Settle(ResolutionState.FAILED, null);
            }
            return new Run(last.prerequisite().authority(), last.prerequisite());
        }

        // (B, C, D, H) A resolver that named a prerequisite is WAITING, and the prerequisite's own result is not the
        // goal's answer. Without this the loop settles on whatever the prerequisite returned and the resolver that
        // asked is never heard from again — measured 2026-09-20: a DECISION whose policy needed the order's fulfilment
        // state reported RESOLVED having evaluated no decision at all, because the order read succeeded. Nothing is
        // planned here: the waiter was named by a resolver after running, and returning to it is the mechanical
        // consequence of that.
        Wait wait = pending(observed);
        if (wait != null) {
            ResolutionState got = wait.result().state();
            if (!got.closesTheNeed()) {
                // (C) The waiter asked for an observation and did not get one. A prerequisite that gapped, failed,
                // found nothing written down, or turned into a question for the customer blocks everyone behind it;
                // resuming on any of those would be resuming as though it had succeeded. The prerequisite's own state
                // becomes the goal's, because it is the honest account of where this stopped.
                return new Settle(got, got == ResolutionState.CAPABILITY_GAP ? wait.result().resolution().gap() : null);
            }
            return new Run(wait.waiter().authority(), wait.waiter());
        }

        ResolutionState state = last.state();
        if (state == ResolutionState.CAPABILITY_GAP) {
            // A capability that could not run does not hand its question to a different authority.
            return new Settle(ResolutionState.CAPABILITY_GAP, last.resolution().gap());
        }

        if (state.closesTheNeed() || state == ResolutionState.NEEDS_CUSTOMER_INPUT || state == ResolutionState.FAILED) {
            return new Settle(state, null);
        }
        // NEEDS_SELLER: the resolver ran and found nothing written down, so a new human judgment is genuinely
        // required. That is where the goal ENDS — see "the seller is a state, not a step" above. Nothing is
        // dispatched here, and the branch that used to dispatch one only ever added a step to three traces.
        return new Settle(ResolutionState.NEEDS_SELLER, null);
    }

    private static Dispatch first(CustomerGoal goal) {
        Authority resolver = goal.requestedOutcome().firstResolver();
        if (!ReferentRegistry.canAct(resolver, goal.subject())) {
            // The registry, not the interpreter, says this deployment cannot answer this here.
            return new Settle(ResolutionState.CAPABILITY_GAP, GapReason.NOT_SUPPORTED);
        }
        if (resolver == Authority.PROCEDURE && !goal.requestedOutcome().mayReachProcedure()) {
            throw new IllegalStateException("only an ACTION reaches a procedure");
        }
        return new Run(resolver, null);
    }

    /**
     * A resolver that is waiting, and the result its prerequisite produced.
     *
     * @param waiter the capability that asked — <b>the exact one</b>, never merely one of the same authority
     * @param result what its prerequisite observed, which is what decides whether the waiter may continue
     */
    private record Wait(CapabilityId waiter, ResolverOutcome result) {
    }

    /**
     * The innermost outstanding wait: a resolver that named a prerequisite, whose prerequisite has since run, and
     * which has not been heard from since. Walked newest-first, so a nested chain comes back innermost-first — the
     * resolver that asked most recently is the one whose question was just answered.
     *
     * <p>Each resume appends an outcome for that capability after its prerequisite, so the same wait cannot fire
     * twice and the loop still terminates on {@link GoalResolution#MAX_STEPS}.
     */
    private static Wait pending(List<ResolverOutcome> observed) {
        for (int i = observed.size() - 1; i >= 0; i--) {
            ResolverOutcome waiter = observed.get(i);
            if (waiter.prerequisite() == null) {
                continue;
            }
            CapabilityId who = waiter.resolution().capability();
            // The LAST word from the prerequisite, not its first. A prerequisite may itself have waited on something
            // and spoken twice; the outcome that decides whether this waiter may continue is the one it ended on.
            int ranAt = -1;
            for (int j = observed.size() - 1; j > i; j--) {
                if (observed.get(j).resolution().capability() == waiter.prerequisite()) {
                    ranAt = j;
                    break;
                }
            }
            if (ranAt < 0) {
                continue; // the prerequisite has not run yet
            }
            boolean heardSince = false;
            for (int j = ranAt + 1; j < observed.size(); j++) {
                if (observed.get(j).resolution().capability() == who) {
                    heardSince = true;
                    break;
                }
            }
            if (!heardSince) {
                return new Wait(who, observed.get(ranAt));
            }
        }
        return null;
    }

    /** How many resolvers have asked for something and not yet been heard from again. */
    private static int openWaits(List<ResolverOutcome> observed) {
        int open = 0;
        for (int i = 0; i < observed.size(); i++) {
            ResolverOutcome waiter = observed.get(i);
            if (waiter.prerequisite() == null) {
                continue;
            }
            CapabilityId who = waiter.resolution().capability();
            boolean heardSince = false;
            for (int j = i + 1; j < observed.size(); j++) {
                if (observed.get(j).resolution().capability() == who) {
                    heardSince = true;
                    break;
                }
            }
            if (!heardSince) {
                open++;
            }
        }
        return open;
    }

    private static boolean alreadyRan(List<ResolverOutcome> observed, CapabilityId capability) {
        return observed.stream().anyMatch(o -> o.resolution().capability() == capability);
    }
}
