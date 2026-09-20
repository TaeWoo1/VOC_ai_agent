package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.AuthorityProvenance;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.ObservedField;
import com.sellerops.inquiry.decision.EvidenceScope;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.authority.ResolutionState;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The properties the Resolution Planner could not hold</b> (Inquiry v3.5 §5, §12).
 *
 * <p>Each test here is one of the five failure shapes the planner reproduced across five prompt versions, restated as
 * something that is true of every reachable input rather than of a sample. They are exhaustive where the input space
 * allows: {@link #onlyAnActionCanReachAProcedure()} enumerates every outcome against every referent.
 */
class ResolutionPolicyInvariantTest {

    private static CustomerGoal goal(RequestedOutcome outcome, Referent subject) {
        return new CustomerGoal("g1", "요청", outcome, subject, RequestBasis.STATED, List.of());
    }

    private static ResolverOutcome ran(CapabilityId capability, ResolutionState state, GapReason gap) {
        return ResolverOutcome.of(new Resolution(capability, state, gap, null, null, null, null));
    }

    /**
     * An order read that actually observed something. {@code Resolution} refuses to let entity state close a goal
     * without a fresh observation, and that rule predates this package and is not relaxed for a test.
     */
    private static ResolverOutcome readOrder() {
        AuthorityProvenance provenance = new AuthorityProvenance(CapabilityId.ENTITY_ORDER,
                EvidenceScope.order("ORDER-1"), AuthorityProvenance.Source.ORDER_EXACT_READ, Instant.EPOCH,
                AuthorityProvenance.Freshness.FRESH);
        return ResolverOutcome.of(new Resolution(CapabilityId.ENTITY_ORDER, ResolutionState.RESOLVED, null, null,
                null, List.of(new ObservedField(EntityField.ORDER_FULFILLMENT, "PREPARING", provenance)), null));
    }

    @Test
    @DisplayName("only an ACTION can reach a procedure — over every outcome and every referent there is")
    void onlyAnActionCanReachAProcedure() {
        for (RequestedOutcome outcome : RequestedOutcome.values()) {
            for (Referent subject : Referent.values()) {
                List<ResolverOutcome> observed = new ArrayList<>();
                // Walk the loop to exhaustion, answering every dispatch with the result most likely to push it onward.
                for (int i = 0; i < GoalResolution.MAX_STEPS; i++) {
                    ResolutionPolicy.Dispatch d = ResolutionPolicy.next(goal(outcome, subject), observed);
                    if (d instanceof ResolutionPolicy.Settle) {
                        break;
                    }
                    ResolutionPolicy.Run run = (ResolutionPolicy.Run) d;
                    assertThat(run.resolver() == Authority.PROCEDURE)
                            .as("%s about %s reached a procedure", outcome, subject)
                            .isEqualTo(outcome == RequestedOutcome.ACTION);
                    observed.add(ran(any(run.resolver()), ResolutionState.NEEDS_SELLER, null));
                }
            }
        }
    }

    @Test
    @DisplayName("an unavailable capability is a gap, and never becomes a different authority")
    void noSemanticSubstitution() {
        for (GapReason reason : GapReason.values()) {
            for (RequestedOutcome outcome : RequestedOutcome.values()) {
                CustomerGoal g = goal(outcome, Referent.CURRENT_ORDER);
                Authority first = outcome.firstResolver();
                if (!ReferentRegistry.canAct(first, Referent.CURRENT_ORDER)) {
                    continue;
                }
                var next = ResolutionPolicy.next(g,
                        List.of(ran(any(first), ResolutionState.CAPABILITY_GAP, reason)));
                assertThat(next).as("%s / %s", outcome, reason).isInstanceOf(ResolutionPolicy.Settle.class);
                ResolutionPolicy.Settle settle = (ResolutionPolicy.Settle) next;
                assertThat(settle.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
                assertThat(settle.gap()).as("the registry's reason is carried, not replaced").isEqualTo(reason);
            }
        }
    }

    @Test
    @DisplayName("the seller is reached from an observed absence, and only for a DECISION")
    void sellerIsNotAFallbackRouter() {
        // Knowledge RAN and found nothing: a new judgment is genuinely required.
        var afterAbsence = ResolutionPolicy.next(goal(RequestedOutcome.DECISION, Referent.ORGANIZATION),
                List.of(ran(CapabilityId.KNOWLEDGE_ORG, ResolutionState.NEEDS_SELLER, null)));
        assertThat(afterAbsence).isInstanceOf(ResolutionPolicy.Run.class);
        assertThat(((ResolutionPolicy.Run) afterAbsence).resolver()).isEqualTo(Authority.SELLER);

        // Knowledge COULD NOT RUN: we do not know whether a policy exists, so we do not claim a judgment is needed.
        var afterGap = ResolutionPolicy.next(goal(RequestedOutcome.DECISION, Referent.ORGANIZATION),
                List.of(ran(CapabilityId.KNOWLEDGE_ORG, ResolutionState.CAPABILITY_GAP, GapReason.UNREADABLE_SOURCE)));
        assertThat(afterGap).isInstanceOf(ResolutionPolicy.Settle.class);
        assertThat(((ResolutionPolicy.Settle) afterGap).state()).isEqualTo(ResolutionState.CAPABILITY_GAP);

        // An INFORMATION goal whose knowledge is absent does not get a seller appended behind it by this function:
        // it settles as NEEDS_SELLER, which the runtime records as an outcome and no plan ever contained.
        var info = ResolutionPolicy.next(goal(RequestedOutcome.INFORMATION, Referent.CURRENT_LISTING),
                List.of(ran(CapabilityId.KNOWLEDGE_PRODUCT, ResolutionState.NEEDS_SELLER, null)));
        assertThat(info).isInstanceOf(ResolutionPolicy.Settle.class);
        assertThat(((ResolutionPolicy.Settle) info).state()).isEqualTo(ResolutionState.NEEDS_SELLER);
    }

    @Test
    @DisplayName("a dispatch is one step — there is no shape in this function that holds a sequence")
    void oneStepAtATime() {
        assertThat(ResolutionPolicy.Dispatch.class.getPermittedSubclasses())
                .containsExactlyInAnyOrder(ResolutionPolicy.Run.class, ResolutionPolicy.Settle.class);
        for (var component : ResolutionPolicy.Run.class.getRecordComponents()) {
            assertThat(java.util.Collection.class.isAssignableFrom(component.getType()))
                    .as("Run.%s would let a dispatch carry a plan", component.getName()).isFalse();
        }
    }

    @Test
    @DisplayName("asking the same capability twice is a loop, and the loop says so instead of spinning")
    void doesNotAskTwice() {
        var trace = GoalResolution.run(goal(RequestedOutcome.ACTION, Referent.CURRENT_ORDER),
                run -> ResolverOutcome.needs(
                        new Resolution(CapabilityId.PROCEDURE_ORDER_ACTION, ResolutionState.NEEDS_SELLER, null, null,
                                null, null, null), CapabilityId.ENTITY_ORDER));
        assertThat(trace.state()).isEqualTo(ResolutionState.FAILED);
        assertThat(trace.steps()).isLessThanOrEqualTo(GoalResolution.MAX_STEPS);
    }

    @Test
    @DisplayName("a resolver whose prerequisite SUCCEEDED is heard from again — the prerequisite's result is not the answer")
    void aWaitingResolverIsResumed() {
        // Measured defect, 2026-09-20: a DECISION whose policy needed the order's fulfilment state settled RESOLVED
        // on the order read. The decision was never evaluated and the goal reported an answer to a question nobody
        // asked. G12 did not catch it because ITS prerequisite fails, and a failed prerequisite settles correctly.
        List<ResolverOutcome> observed = new ArrayList<>();
        observed.add(ResolverOutcome.needs(new Resolution(CapabilityId.KNOWLEDGE_ORG, ResolutionState.NEEDS_SELLER,
                null, null, null, null, null), CapabilityId.ENTITY_ORDER));
        var toPrerequisite = ResolutionPolicy.next(goal(RequestedOutcome.DECISION, Referent.CURRENT_ORDER), observed);
        assertThat(((ResolutionPolicy.Run) toPrerequisite).capability()).isEqualTo(CapabilityId.ENTITY_ORDER);

        observed.add(readOrder());
        var back = ResolutionPolicy.next(goal(RequestedOutcome.DECISION, Referent.CURRENT_ORDER), observed);
        assertThat(back).as("the loop settled on the prerequisite instead of returning to the decision")
                .isInstanceOf(ResolutionPolicy.Run.class);
        assertThat(((ResolutionPolicy.Run) back).capability()).isEqualTo(CapabilityId.KNOWLEDGE_ORG);

        // ...and once the waiter has spoken it is not resumed again: the same wait cannot fire twice.
        observed.add(ran(CapabilityId.KNOWLEDGE_ORG, ResolutionState.NEEDS_SELLER, null));
        var after = ResolutionPolicy.next(goal(RequestedOutcome.DECISION, Referent.CURRENT_ORDER), observed);
        assertThat(((ResolutionPolicy.Run) after).resolver()).isEqualTo(Authority.SELLER);
    }

    @Test
    @DisplayName("a prerequisite that GAPPED ends the goal — the waiter cannot proceed and is not resumed")
    void aFailedPrerequisiteIsNotResumedPast() {
        List<ResolverOutcome> observed = new ArrayList<>();
        observed.add(ResolverOutcome.needs(new Resolution(CapabilityId.PROCEDURE_ORDER_ACTION,
                ResolutionState.NEEDS_SELLER, null, null, null, null, null), CapabilityId.ENTITY_ORDER));
        observed.add(ran(CapabilityId.ENTITY_ORDER, ResolutionState.CAPABILITY_GAP, GapReason.UNBOUND));
        var next = ResolutionPolicy.next(goal(RequestedOutcome.ACTION, Referent.CURRENT_ORDER), observed);
        assertThat(next).isInstanceOf(ResolutionPolicy.Settle.class);
        assertThat(((ResolutionPolicy.Settle) next).gap()).isEqualTo(GapReason.UNBOUND);
    }

    @Test
    @DisplayName("every bound referent has capabilities, and every capability scope has a referent")
    void referentsAndCapabilitiesCorrespond() {
        var covered = EnumSet.noneOf(CapabilityId.class);
        for (Referent r : Referent.values()) {
            assertThat(ReferentRegistry.capabilitiesAbout(r).isEmpty()).as("%s", r).isNotEqualTo(r.bound());
            covered.addAll(ReferentRegistry.capabilitiesAbout(r));
        }
        assertThat(covered).as("a capability nothing can be about is unreachable")
                .containsExactlyInAnyOrder(CapabilityId.values());
        assertThat(ReferentRegistry.bound()).doesNotContain(Referent.UNRESOLVED);
    }

    private static CapabilityId any(Authority authority) {
        return switch (authority) {
            case KNOWLEDGE -> CapabilityId.KNOWLEDGE_ORG;
            case ENTITY_STATE -> CapabilityId.ENTITY_ORDER;
            case PROCEDURE -> CapabilityId.PROCEDURE_ORDER_ACTION;
            case SELLER -> CapabilityId.SELLER;
        };
    }
}
