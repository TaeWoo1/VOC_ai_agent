package com.sellerops.inquiry.goal;

import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.authority.ResolutionState;

/**
 * <b>What one resolver observed</b> (Inquiry v3.5) — the only thing that may decide what happens next.
 *
 * <p>It wraps the existing {@link Resolution}, which already carries the state, the gap reason, the observed fields
 * and — importantly — {@code ask}, the customer input <b>the resolver</b> decided it was missing. That field has been
 * the resolver's since the authority layer was built; what changed in v3.5 is that nothing upstream produces a second,
 * competing list of inputs alongside it.
 *
 * <p>The one thing added here is {@link #prerequisite()}: a resolver may say <b>"I cannot proceed until this other
 * capability has run"</b>. This is the only legal form of chaining in the loop, and it is deliberately backwards from
 * a plan — the next step is named by the resolver that just ran, after running, rather than by a model before anything
 * ran. A procedure that needs the order read says so from inside the procedure definition; nobody predicted it.
 *
 * @param resolution   what this resolver observed
 * @param prerequisite a capability that must run before this resolver can continue, or null
 */
public record ResolverOutcome(Resolution resolution, CapabilityId prerequisite) {

    public ResolverOutcome {
        if (resolution == null) {
            throw new IllegalArgumentException("an outcome is an observation");
        }
        if (prerequisite != null && resolution.state() != ResolutionState.FAILED
                && resolution.state().closesTheNeed()) {
            throw new IllegalArgumentException("a resolver that closed the goal is not waiting on anything");
        }
        if (prerequisite == resolution.capability()) {
            throw new IllegalArgumentException("a resolver does not wait on itself");
        }
    }

    public static ResolverOutcome of(Resolution resolution) {
        return new ResolverOutcome(resolution, null);
    }

    /** The resolver ran and needs another capability to run first. */
    public static ResolverOutcome needs(Resolution resolution, CapabilityId prerequisite) {
        if (prerequisite == null) {
            throw new IllegalArgumentException("a prerequisite is named");
        }
        return new ResolverOutcome(resolution, prerequisite);
    }

    public ResolutionState state() {
        return resolution.state();
    }
}
