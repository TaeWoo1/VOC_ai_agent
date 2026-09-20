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
 *   <tr><td>{@code INFORMATION}</td><td>Knowledge</td></tr>
 *   <tr><td>{@code STATE_READ}</td><td>Entity State</td></tr>
 *   <tr><td>{@code ACTION}</td><td>Procedure</td></tr>
 *   <tr><td>{@code DECISION}</td><td>Knowledge <b>first</b> — then, only if it ran and found nothing, the seller</td></tr>
 * </table>
 *
 * <p><b>The decision path is the point of §10.</b> "Is this returnable after the window?" is not a seller question
 * because it contains the word decide; it is a seller question only when no written policy decides it. So knowledge is
 * asked first, and the seller is reached from an <b>observed absence</b>, never from the outcome kind alone.
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

        // The only chaining there is: the resolver that just ran named what must run before it can continue.
        if (last.prerequisite() != null) {
            if (alreadyRan(observed, last.prerequisite())) {
                // Asking twice for the same thing is a loop, not progress.
                return new Settle(ResolutionState.FAILED, null);
            }
            return new Run(last.prerequisite().authority(), last.prerequisite());
        }

        ResolutionState state = last.state();
        if (state == ResolutionState.CAPABILITY_GAP) {
            // A capability that could not run does not hand its question to a different authority — and a resolver
            // waiting on it cannot continue either, so this is checked before the resume below.
            return new Settle(ResolutionState.CAPABILITY_GAP, last.resolution().gap());
        }

        // A resolver that named a prerequisite is WAITING, and the prerequisite's own result is not the goal's answer.
        // Without this the loop settles on whatever the prerequisite returned and the resolver that asked is never
        // heard from again — measured: a DECISION whose policy needed the order's fulfilment state reported RESOLVED
        // having evaluated no decision at all, because the order read succeeded. Nothing is planned here: the waiter
        // was named by a resolver after running, and resuming it is the mechanical consequence of that.
        CapabilityId waiting = resumable(observed);
        if (waiting != null) {
            return new Run(waiting.authority(), waiting);
        }

        if (state.closesTheNeed() || state == ResolutionState.NEEDS_CUSTOMER_INPUT || state == ResolutionState.FAILED) {
            return new Settle(state, null);
        }
        // NEEDS_SELLER: the resolver ran and found nothing written down.
        if (goal.requestedOutcome() == RequestedOutcome.DECISION
                && last.resolution().authority() == Authority.KNOWLEDGE
                && !alreadyRan(observed, CapabilityId.SELLER)) {
            // §10: no policy decides this, so a new seller judgment is genuinely required — and only now.
            return new Run(Authority.SELLER, CapabilityId.SELLER);
        }
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
     * The resolver that is still waiting, if any: one that named a prerequisite, whose prerequisite has since run,
     * and which has not been heard from since. Walked newest-first so a nested wait resumes innermost-first.
     *
     * <p>Each resume appends an outcome for that capability after its prerequisite, so the same wait cannot fire
     * twice and the loop still terminates on {@link GoalResolution#MAX_STEPS}.
     */
    private static CapabilityId resumable(List<ResolverOutcome> observed) {
        for (int i = observed.size() - 1; i >= 0; i--) {
            ResolverOutcome waiter = observed.get(i);
            if (waiter.prerequisite() == null) {
                continue;
            }
            CapabilityId who = waiter.resolution().capability();
            int ranAt = -1;
            for (int j = i + 1; j < observed.size(); j++) {
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
                return who;
            }
        }
        return null;
    }

    private static boolean alreadyRan(List<ResolverOutcome> observed, CapabilityId capability) {
        return observed.stream().anyMatch(o -> o.resolution().capability() == capability);
    }
}
