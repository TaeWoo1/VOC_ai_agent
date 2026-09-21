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
        return new CustomerGoal("g1", "요청", outcome, subject, RequestBasis.STATED, List.of(), "요청");
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
    @DisplayName("human authority is reached from an observed absence, and it is a TERMINAL rather than a step")
    void sellerIsNotAFallbackRouter() {
        // Knowledge RAN and found nothing: a new human judgment is genuinely required, and that is where the goal
        // ENDS. Before v3 this dispatched CapabilityId.SELLER for a DECISION and settled for everything else — two
        // spellings of one outcome. The frozen gold had already voted: 35 goals terminate NEEDS_SELLER and 32 reach
        // it with no seller step, while the seller resolver closes 0 of 72. See RequestedOutcome.
        for (Referent subject : List.of(Referent.ORGANIZATION, Referent.CURRENT_LISTING)) {
            CapabilityId knowledge = subject == Referent.ORGANIZATION
                    ? CapabilityId.KNOWLEDGE_ORG : CapabilityId.KNOWLEDGE_PRODUCT;
            var afterAbsence = ResolutionPolicy.next(goal(RequestedOutcome.ANSWER, subject),
                    List.of(ran(knowledge, ResolutionState.NEEDS_SELLER, null)));
            assertThat(afterAbsence).as("%s", subject).isInstanceOf(ResolutionPolicy.Settle.class);
            assertThat(((ResolutionPolicy.Settle) afterAbsence).state())
                    .isEqualTo(ResolutionState.NEEDS_SELLER);
        }

        // Knowledge COULD NOT RUN: we do not know whether a policy exists, so we do not claim a judgment is needed.
        // This is the distinction the merge had to leave standing, because it is the one that can lie.
        var afterGap = ResolutionPolicy.next(goal(RequestedOutcome.ANSWER, Referent.ORGANIZATION),
                List.of(ran(CapabilityId.KNOWLEDGE_ORG, ResolutionState.CAPABILITY_GAP, GapReason.UNREADABLE_SOURCE)));
        assertThat(afterGap).isInstanceOf(ResolutionPolicy.Settle.class);
        assertThat(((ResolutionPolicy.Settle) afterGap).state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
    }

    /**
     * <b>The merge did not widen the loop, and this is the assertion that says so.</b>
     *
     * <p>The other way to merge {@code INFORMATION} and {@code DECISION} was to keep the seller dispatch and key it
     * on the observed absence instead of the token — which {@link ResolutionPolicy}'s own class comment used to
     * claim it already did. Measured against the frozen gold that would have added a seller step to <b>30 more</b>
     * goals and closed none of them. So no dispatch of {@link CapabilityId#SELLER} may come out of this function,
     * under any outcome, from any absence.
     */
    @Test
    @DisplayName("no observed absence, under any outcome, dispatches the seller")
    void theLoopNeverDispatchesTheSeller() {
        for (RequestedOutcome outcome : RequestedOutcome.values()) {
            for (CapabilityId ran : List.of(CapabilityId.KNOWLEDGE_ORG, CapabilityId.KNOWLEDGE_PRODUCT,
                    CapabilityId.KNOWLEDGE_CATALOGUE, CapabilityId.ENTITY_ORDER, CapabilityId.ENTITY_LISTING,
                    CapabilityId.PROCEDURE_ORDER_ACTION)) {
                var d = ResolutionPolicy.next(goal(outcome, Referent.CURRENT_ORDER),
                        List.of(ran(ran, ResolutionState.NEEDS_SELLER, null)));
                assertThat(d).as("%s after %s", outcome, ran).isInstanceOf(ResolutionPolicy.Settle.class);
                assertThat(((ResolutionPolicy.Settle) d).state()).isEqualTo(ResolutionState.NEEDS_SELLER);
            }
        }
        assertThat(Authority.SELLER).as("the authority still exists; it is simply not something this loop asks")
                .isNotNull();
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
        var toPrerequisite = ResolutionPolicy.next(goal(RequestedOutcome.ANSWER, Referent.CURRENT_ORDER), observed);
        assertThat(((ResolutionPolicy.Run) toPrerequisite).capability()).isEqualTo(CapabilityId.ENTITY_ORDER);

        observed.add(readOrder());
        var back = ResolutionPolicy.next(goal(RequestedOutcome.ANSWER, Referent.CURRENT_ORDER), observed);
        assertThat(back).as("the loop settled on the prerequisite instead of returning to the decision")
                .isInstanceOf(ResolutionPolicy.Run.class);
        assertThat(((ResolutionPolicy.Run) back).capability()).isEqualTo(CapabilityId.KNOWLEDGE_ORG);

        // ...and once the waiter has spoken it is not resumed again: the same wait cannot fire twice. It ends where
        // an observed absence ends — at the terminal, with nothing dispatched behind it.
        observed.add(ran(CapabilityId.KNOWLEDGE_ORG, ResolutionState.NEEDS_SELLER, null));
        var after = ResolutionPolicy.next(goal(RequestedOutcome.ANSWER, Referent.CURRENT_ORDER), observed);
        assertThat(after).isInstanceOf(ResolutionPolicy.Settle.class);
        assertThat(((ResolutionPolicy.Settle) after).state()).isEqualTo(ResolutionState.NEEDS_SELLER);
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
    @DisplayName("C: a prerequisite that produced no observation blocks the waiter, whatever the reason")
    void aBlockedPrerequisiteIsNeverResumedPast() {
        // The 09f34a28 fix stopped the resume for CAPABILITY_GAP only. Everything else — the resolver ran and found
        // nothing, it turned into a question for the customer, it broke — fell through to the resume, and the waiter
        // was dispatched as though its question had been answered. A resolver that asked for an observation and did
        // not get one cannot continue, and the honest terminal is the prerequisite's own state.
        for (ResolutionState blocking : List.of(ResolutionState.NEEDS_SELLER, ResolutionState.NEEDS_CUSTOMER_INPUT,
                ResolutionState.FAILED)) {
            List<ResolverOutcome> observed = new ArrayList<>();
            observed.add(ResolverOutcome.needs(new Resolution(CapabilityId.KNOWLEDGE_ORG,
                    ResolutionState.NEEDS_SELLER, null, null, null, null, null), CapabilityId.ENTITY_ORDER));
            observed.add(ResolverOutcome.of(new Resolution(CapabilityId.ENTITY_ORDER, blocking, null, null,
                    blocking == ResolutionState.NEEDS_CUSTOMER_INPUT
                            ? List.of(com.sellerops.inquiry.authority.CustomerInput.OPTION) : null, null, null)));
            var next = ResolutionPolicy.next(goal(RequestedOutcome.ANSWER, Referent.CURRENT_ORDER), observed);
            assertThat(next).as("%s resumed the waiter", blocking).isInstanceOf(ResolutionPolicy.Settle.class);
            assertThat(((ResolutionPolicy.Settle) next).state()).isEqualTo(blocking);
        }
    }

    @Test
    @DisplayName("D: a prerequisite succeeding is never the goal being resolved")
    void aPrerequisiteIsNotTheAnswer() {
        List<ResolverOutcome> observed = new ArrayList<>();
        observed.add(ResolverOutcome.needs(new Resolution(CapabilityId.KNOWLEDGE_ORG, ResolutionState.NEEDS_SELLER,
                null, null, null, null, null), CapabilityId.ENTITY_ORDER));
        observed.add(readOrder());
        // The order read RESOLVED. If that were allowed to settle the goal, a decision would report an answer having
        // evaluated nothing — the defect measured on 2026-09-20.
        var next = ResolutionPolicy.next(goal(RequestedOutcome.ANSWER, Referent.CURRENT_ORDER), observed);
        assertThat(next).isInstanceOf(ResolutionPolicy.Run.class);
        assertThat(((ResolutionPolicy.Run) next).capability()).isEqualTo(CapabilityId.KNOWLEDGE_ORG);
    }

    @Test
    @DisplayName("F: a cycle ends closed — R1 waits on R2 waits on R1 never completes a lap")
    void aCycleFailsClosed() {
        var trace = GoalResolution.run(goal(RequestedOutcome.ACTION, Referent.CURRENT_ORDER), run ->
                switch (run.resolver()) {
                    case PROCEDURE -> ResolverOutcome.needs(new Resolution(CapabilityId.PROCEDURE_ORDER_ACTION,
                            ResolutionState.NEEDS_SELLER, null, null, null, null, null), CapabilityId.KNOWLEDGE_ORG);
                    case KNOWLEDGE -> ResolverOutcome.needs(new Resolution(CapabilityId.KNOWLEDGE_ORG,
                            ResolutionState.NEEDS_SELLER, null, null, null, null, null),
                            CapabilityId.PROCEDURE_ORDER_ACTION);
                    default -> throw new IllegalStateException("the cycle reached a third resolver");
                });
        assertThat(trace.state()).isEqualTo(ResolutionState.FAILED);
        assertThat(trace.steps()).as("detected on the second request, not by running out of steps").isEqualTo(2);
    }

    @Test
    @DisplayName("G: the wait bound is the registry's size — a number nobody chose, and the loop stops under it")
    void theDepthBoundIsDerived() {
        assertThat(ResolutionPolicy.MAX_WAIT_DEPTH).isEqualTo(CapabilityId.values().length - 1);
        // A wait chain visits distinct capabilities (a repeat is refused above), so the registry bounds it from
        // above, and MAX_STEPS stops the loop before it could even use every capability once.
        assertThat(GoalResolution.MAX_STEPS).isLessThanOrEqualTo(CapabilityId.values().length);
    }

    @Test
    @DisplayName("H and I: the exact waiter is resumed, and the prerequisite's observation is still there to read")
    void theWaiterResumedIsTheOneThatAsked() {
        // Two knowledge capabilities are in play; only the one that asked may come back.
        List<ResolverOutcome> observed = new ArrayList<>();
        observed.add(ResolverOutcome.of(new Resolution(CapabilityId.KNOWLEDGE_PRODUCT, ResolutionState.NEEDS_SELLER,
                null, null, null, null, null)));
        observed.add(ResolverOutcome.needs(new Resolution(CapabilityId.KNOWLEDGE_ORG, ResolutionState.NEEDS_SELLER,
                null, null, null, null, null), CapabilityId.ENTITY_ORDER));
        observed.add(readOrder());
        var next = ResolutionPolicy.next(goal(RequestedOutcome.ANSWER, Referent.CURRENT_ORDER), observed);
        assertThat(((ResolutionPolicy.Run) next).capability())
                .as("a different capability of the same authority is a different resolver")
                .isEqualTo(CapabilityId.KNOWLEDGE_ORG);

        // (I) What the prerequisite saw, with its provenance, is in the trace the resumed resolver reads. An
        // observation whose source and freshness were dropped on the way back is not an observation any more.
        assertThat(observed.get(2).resolution().observed()).singleElement().satisfies(o -> {
            assertThat(o.field()).isEqualTo(EntityField.ORDER_FULFILLMENT);
            assertThat(o.provenance().capability()).isEqualTo(CapabilityId.ENTITY_ORDER);
            assertThat(o.provenance().freshness()).isEqualTo(AuthorityProvenance.Freshness.FRESH);
        });
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
