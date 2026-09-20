package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.authority.ResolutionState;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The one relationship a customer can state, and the one thing the runtime may do with it</b> (Inquiry v3.5 §F).
 *
 * <p>The row this exists for is a single message: <i>"send just the nozzle … if sending only the nozzle is
 * impossible, refund me."</i> Two action goals, and an order between them that the customer wrote down. Held as two
 * equal goals it is a refund waiting to be issued by accident.
 *
 * <p>Two properties are load-bearing and neither is a sentence in a prompt. A relation <b>cannot be constructed</b>
 * without the customer's own conditional clause, and a goal on the receiving end of one is <b>never attempted</b>,
 * for every terminal state and every gap reason this system can produce.
 */
class GoalRelationTest {

    private static CustomerGoal action(String id, String request) {
        return new CustomerGoal(id, request, RequestedOutcome.ACTION, Referent.CURRENT_ORDER, RequestBasis.STATED,
                List.of());
    }

    private static final CustomerGoal NOZZLE = action("g1", "노즐 부분만 따로 배송해 주세요");
    private static final CustomerGoal REFUND = action("g2", "환불처리 해주세요");
    private static final String STATED = "노즐만 배송이 불가능하면";

    @Test
    @DisplayName("two action goals with no conditional clause cannot be related — there is nothing to put in the field")
    void anInventedFallbackCannotBeConstructed() {
        for (String nothingSaid : new String[] {null, "", "   "}) {
            assertThatThrownBy(() -> GoalRelation.fallback("g1", "g2", nothingSaid))
                    .as("a relation with no stated condition is the invented fallback this contract exists to refuse")
                    .isInstanceOf(IllegalArgumentException.class);
        }
        // And the clause is a clause: a model that wants to relate two goals quotes the customer, it does not explain.
        assertThatThrownBy(() -> GoalRelation.fallback("g1", "g2", "x".repeat(GoalRelation.MAX_CONDITION + 1)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(GoalRelation.fallback("g1", "g2", STATED).statedCondition()).isEqualTo(STATED);
    }

    @Test
    @DisplayName("a relation relates goals and nothing else — no resolver, authority, capability, order or step fits")
    void whatARelationCannotCarry() {
        List<String> components = Stream.of(GoalRelation.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).toList();
        assertThat(components).containsExactly("kind", "primaryGoalId", "fallbackGoalId", "statedCondition");
        assertThat(components).doesNotContain("capability", "authority", "resolver", "step", "order", "sequence",
                "trigger", "gap", "state", "procedure", "prerequisite");
        // One kind, and it is a thing customers say. Every candidate beside it described how work should be carried
        // out — which is the question the withdrawn planner answered wrongly and which no customer sentence answers.
        assertThat(GoalRelation.Kind.values()).containsExactly(GoalRelation.Kind.FALLBACK);
    }

    @Test
    @DisplayName("the set is a forest of chains, never a graph and never a loop")
    void theShapeRefusesAPlan() {
        assertThatThrownBy(() -> new CustomerGoalSet(List.of(NOZZLE, REFUND, action("g3", "교환해 주세요")),
                List.of(GoalRelation.fallback("g1", "g2", STATED), GoalRelation.fallback("g1", "g3", STATED))))
                .as("a second fallback from one goal is a ranking nobody wrote")
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new CustomerGoalSet(List.of(NOZZLE, REFUND, action("g3", "교환해 주세요")),
                List.of(GoalRelation.fallback("g1", "g2", STATED), GoalRelation.fallback("g3", "g2", STATED))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new CustomerGoalSet(List.of(NOZZLE, REFUND),
                List.of(GoalRelation.fallback("g1", "g2", STATED), GoalRelation.fallback("g2", "g1", STATED))))
                .as("'A if not B, B if not A' is not a thing a customer can mean")
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new CustomerGoalSet(List.of(NOZZLE),
                List.of(GoalRelation.fallback("g1", "g2", STATED))))
                .as("a relation reaching outside the message relates work that is not in front of us")
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GoalRelation.fallback("g1", "g1", STATED)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("nothing in the resolution loop can read a relation — it has nowhere to put one")
    void theLoopCannotSeeIt() {
        for (var method : ResolutionPolicy.class.getDeclaredMethods()) {
            for (var parameter : method.getParameterTypes()) {
                assertThat(parameter).as("ResolutionPolicy.%s would let a relation choose a resolver", method.getName())
                        .isNotIn(GoalRelation.class, CustomerGoalSet.class);
            }
        }
        // And the goal itself has no fallback field: the relationship lives beside the goals, never inside one.
        assertThat(Stream.of(CustomerGoal.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).toList()).doesNotContain("fallback", "relation");
    }

    @Test
    @DisplayName("CAPABILITY_GAP is not impossibility — no terminal state of the primary activates a fallback")
    void aGapIsNotARefusal() {
        CustomerGoalSet set = new CustomerGoalSet(List.of(NOZZLE, REFUND),
                List.of(GoalRelation.fallback("g1", "g2", STATED)));
        // Every way this runtime can actually end an ACTION goal, including every reason a capability can be missing.
        // Not one of them is "the seller considered this and refused", and there is no producer of that fact here.
        List<ResolverOutcome> endings = new java.util.ArrayList<>();
        endings.add(primary(ResolutionState.NEEDS_SELLER, null));
        endings.add(primary(ResolutionState.NEEDS_CUSTOMER_INPUT, null));
        endings.add(primary(ResolutionState.FAILED, null));
        for (GapReason reason : GapReason.values()) {
            endings.add(primary(ResolutionState.CAPABILITY_GAP, reason));
        }
        for (ResolverOutcome ending : endings) {
            GoalSetResolution.Outcome outcome = GoalSetResolution.run(set, run -> ending);
            GoalSetResolution.Entry refund = outcome.of("g2");
            assertThat(refund.disposition()).as("%s / %s activated a refund the customer made conditional",
                    ending.state(), ending.resolution().gap())
                    .isEqualTo(GoalSetResolution.Disposition.WITHHELD_FOR_CUSTOMER_STATED_CONDITION);
            assertThat(refund.trace()).as("a withheld goal was never dispatched at all").isNull();
            assertThat(refund.condition().statedCondition()).isEqualTo(STATED);
        }

        // The two endings NOT in that list are missing for a reason worth writing down: a procedure never closes a
        // need in this registry, so an action goal cannot reach RESOLVED at all. Every action goal ends in one of the
        // shapes above, and the most common of them by far is the gap — which is exactly why reading a gap as a
        // refusal would refund every customer who ever wrote a conditional sentence.
        assertThatThrownBy(() -> Resolution.of(CapabilityId.PROCEDURE_ORDER_ACTION, ResolutionState.RESOLVED))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("no resolver is ever asked for a withheld goal — the refusal is that nobody is consulted")
    void theFallbackIsNotResolvedQuietly() {
        CustomerGoalSet set = new CustomerGoalSet(List.of(NOZZLE, REFUND),
                List.of(GoalRelation.fallback("g1", "g2", STATED)));
        List<String> asked = new java.util.ArrayList<>();
        GoalSetResolution.run(set, run -> {
            asked.add(run.resolver().name());
            return primary(ResolutionState.CAPABILITY_GAP, GapReason.NOT_EXECUTABLE);
        });
        assertThat(asked).as("one goal was attempted, and it was the unconditional one").containsExactly("PROCEDURE");
        assertThat(set.unconditional()).extracting(CustomerGoal::id).containsExactly("g1");
    }

    @Test
    @DisplayName("a message with no conditional clause behaves exactly as it did before this type existed")
    void theOrdinaryCaseIsUnchanged() {
        CustomerGoalSet set = CustomerGoalSet.of(NOZZLE, REFUND);
        GoalSetResolution.Outcome outcome = GoalSetResolution.run(set,
                run -> primary(ResolutionState.CAPABILITY_GAP, GapReason.NOT_EXECUTABLE));
        assertThat(outcome.withheld()).as("the customer named two things and did not rank them").isEmpty();
        assertThat(outcome.entries()).allSatisfy(e -> assertThat(e.trace()).isNotNull());
    }

    private static ResolverOutcome primary(ResolutionState state, GapReason reason) {
        List<com.sellerops.inquiry.authority.CustomerInput> ask =
                state == ResolutionState.NEEDS_CUSTOMER_INPUT
                        ? List.of(com.sellerops.inquiry.authority.CustomerInput.OPTION) : List.of();
        return ResolverOutcome.of(new Resolution(CapabilityId.PROCEDURE_ORDER_ACTION, state, reason, null, ask, null,
                null));
    }
}
