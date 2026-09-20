package com.sellerops.inquiry.goal;

import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.ResolutionState;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * <b>The resolution loop</b> (Inquiry v3.5): interpret, select a resolver, run it, look at what happened, repeat.
 *
 * <pre>
 *   INTERPRETED → RESOLVER_SELECTED → RESOLVING → (RESOLVER_SELECTED | SETTLED)
 * </pre>
 *
 * <p><b>The terminal vocabulary is not new.</b> The brief offered seven candidate end states; the audit found six of
 * them already declared in {@link ResolutionState} and in use — {@code RESOLVED}, {@code RESOLVED_CONDITIONAL},
 * {@code NEEDS_CUSTOMER_INPUT}, {@code NEEDS_SELLER}, {@code CAPABILITY_GAP}, {@code FAILED} — and the seventh,
 * "system can go acquire this", already expressible as {@link GapReason#ACQUIRABLE}. So <b>nothing was added</b>.
 *
 * <p>The one candidate deliberately <b>not</b> created is {@code ACTION_REQUIRES_APPROVAL}. It has no producer: every
 * procedure in this registry is {@code DECLARED_NO_EXECUTOR}, so an action goal terminates at
 * {@code CAPABILITY_GAP / NOT_EXECUTABLE} and cannot reach an approval. When an executor exists, approval belongs to
 * the execution lane that already owns it, not to this loop. A state nothing can produce is a state nobody can test.
 *
 * <p><b>Why a loop rather than a plan.</b> Every step after the first is chosen by looking at a result. The planner
 * could not do that — it wrote the whole sequence before the first capability ran, which is why an unavailable
 * capability turned into a different authority and a decision turned into a procedure. Here an unavailable capability
 * simply ends the loop with the registry's reason, because there is no pre-written next step to fall into.
 */
public final class GoalResolution {

    /** A resolution cannot take more steps than there are capabilities to take them with. */
    public static final int MAX_STEPS = 6;

    private GoalResolution() {
    }

    public enum Phase { INTERPRETED, RESOLVER_SELECTED, RESOLVING, SETTLED }

    /**
     * @param goal     unchanged for the whole loop — resolving does not revise what the customer asked
     * @param observed every resolver outcome, oldest first: the loop's whole memory
     */
    public record Trace(CustomerGoal goal, List<ResolverOutcome> observed, ResolutionState state, GapReason gap,
                        Phase phase) {
        public Trace {
            observed = observed == null ? List.of() : List.copyOf(observed);
        }

        public int steps() {
            return observed.size();
        }
    }

    /**
     * Run the loop. {@code resolver} is asked for one dispatch at a time and may look at anything it likes; what it
     * may not do is tell this loop what comes after, and it has no way to.
     */
    public static Trace run(CustomerGoal goal, Function<ResolutionPolicy.Run, ResolverOutcome> resolver) {
        List<ResolverOutcome> observed = new ArrayList<>();
        for (int i = 0; i <= MAX_STEPS; i++) {
            ResolutionPolicy.Dispatch dispatch = ResolutionPolicy.next(goal, observed);
            if (dispatch instanceof ResolutionPolicy.Settle settle) {
                return new Trace(goal, observed, settle.state(), settle.gap(), Phase.SETTLED);
            }
            if (i == MAX_STEPS) {
                break;
            }
            ResolverOutcome outcome = resolver.apply((ResolutionPolicy.Run) dispatch);
            if (outcome == null) {
                return new Trace(goal, observed, ResolutionState.FAILED, null, Phase.SETTLED);
            }
            observed.add(outcome);
        }
        return new Trace(goal, observed, ResolutionState.FAILED, null, Phase.SETTLED);
    }
}
