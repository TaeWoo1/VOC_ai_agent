package com.sellerops.inquiry.authority;

import java.util.List;

/**
 * How one resolution step ended, and why — the unit every later planner, resolver, seller packet and eval reads.
 *
 * <p>The constructor holds the invariants no caller may break:
 * <ul>
 *   <li>a gap reason exists exactly when the state is {@link ResolutionState#CAPABILITY_GAP};</li>
 *   <li>nothing asks the customer for identity ({@link CustomerInput.Kind#IDENTITY});</li>
 *   <li>an ENTITY_STATE step that closes a need rests only on FRESH observations — a stale row is cited, never «now»;</li>
 *   <li><b>a PROCEDURE never closes a need</b> — v3.0 has no executor, and a sentence is not an action.</li>
 * </ul>
 *
 * @param missing       fields (or, for knowledge, nothing) the step could not supply
 * @param ask           product-context values the customer should be asked for
 * @param observed      what an ENTITY_STATE step saw, with provenance
 * @param preconditions for a PROCEDURE: the entity steps its packet carries
 */
public record Resolution(CapabilityId capability, ResolutionState state, GapReason gap, List<EntityField> missing,
                         List<CustomerInput> ask, List<ObservedField> observed, List<Resolution> preconditions) {

    public Resolution {
        if (capability == null || state == null) {
            throw new IllegalArgumentException("a resolution names its capability and its state");
        }
        if ((state == ResolutionState.CAPABILITY_GAP) != (gap != null)) {
            throw new IllegalArgumentException("a gap reason is given exactly for CAPABILITY_GAP");
        }
        missing = missing == null ? List.of() : List.copyOf(missing);
        ask = ask == null ? List.of() : List.copyOf(ask);
        observed = observed == null ? List.of() : List.copyOf(observed);
        preconditions = preconditions == null ? List.of() : List.copyOf(preconditions);
        if (ask.stream().anyMatch(a -> a.kind() == CustomerInput.Kind.IDENTITY)) {
            throw new IllegalArgumentException("identity is never asked of the customer");
        }
        if ((state == ResolutionState.NEEDS_CUSTOMER_INPUT || state == ResolutionState.RESOLVED_CONDITIONAL)
                && ask.isEmpty()) {
            throw new IllegalArgumentException(state + " names what to ask");
        }
        if (capability.authority() == Authority.PROCEDURE && state.closesTheNeed()) {
            throw new IllegalArgumentException("a procedure never closes a need without an executor");
        }
        if (capability.authority() == Authority.ENTITY_STATE && state.closesTheNeed() && (observed.isEmpty()
                || observed.stream().anyMatch(o -> o.provenance().freshness() != AuthorityProvenance.Freshness.FRESH))) {
            throw new IllegalArgumentException("entity state closes a need only on fresh observations");
        }
    }

    public Authority authority() {
        return capability.authority();
    }

    public static Resolution of(CapabilityId capability, ResolutionState state) {
        return new Resolution(capability, state, null, null, null, null, null);
    }

    public static Resolution gap(CapabilityId capability, GapReason reason, List<EntityField> missing,
                                 List<ObservedField> observed) {
        return new Resolution(capability, ResolutionState.CAPABILITY_GAP, reason, missing, null, observed, null);
    }
}
