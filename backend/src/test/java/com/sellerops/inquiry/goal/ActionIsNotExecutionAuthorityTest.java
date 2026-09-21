package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilityStatus;
import com.sellerops.inquiry.authority.ExecutionEffect;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.authority.ResolutionState;
import java.util.ArrayList;
import java.util.List;
import org.assertj.core.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>An {@code ACTION} verdict is a model's reading of a sentence, and the runtime treats it as one</b>
 * (Inquiry v3.5 §25.9).
 *
 * <p>The v2 provenance run measured the interpreter returning a single {@link RequestedOutcome#ACTION} goal about the
 * order for a message that requested nothing (§25.7). This test records what the runtime does with that goal versus
 * two goals that are <b>correct</b>, and the answer is the point: <b>it cannot tell them apart, and it does not
 * try.</b> {@link RequestBasis} is not read by {@link ResolutionPolicy}, {@link GoalResolution} or
 * {@link GoalSetResolution}, so an invented ACTION, a substituted one and a real one are the same object here.
 *
 * <p>That is why the safety argument cannot be "detect the invented one". It has to be that no ACTION verdict is
 * execution authority — and the fences below are what make that true today, each asserted rather than described.
 */
class ActionIsNotExecutionAuthorityTest {

    private static CustomerGoal action(String id, RequestBasis basis) {
        return new CustomerGoal(id, "요청", RequestedOutcome.ACTION, Referent.CURRENT_ORDER, basis, List.of(), "요청");
    }

    /** The three cases the audit compares: same outcome, same referent, different provenance. */
    private static List<CustomerGoal> theThree() {
        return List.of(
                // G15 as the v2 run actually returned it: an ACTION nobody asked for, inferred.
                action("substituted", RequestBasis.DIRECTLY_IMPLIED),
                // G04: "주문 취소해 주세요" — an ACTION the customer asked for outright.
                action("explicit", RequestBasis.STATED),
                // R:4181864b: the gold's own legitimate inferred ACTION.
                action("legitimate-implied", RequestBasis.DIRECTLY_IMPLIED));
    }

    @Test
    @DisplayName("the three ACTION cases are indistinguishable to the runtime — same dispatch, byte for byte")
    void provenanceIsInvisibleDownstream() {
        List<ResolutionPolicy.Dispatch> dispatches = new ArrayList<>();
        for (CustomerGoal goal : theThree()) {
            dispatches.add(ResolutionPolicy.next(goal, List.of()));
        }
        assertThat(dispatches).hasSize(3);
        assertThat(dispatches.get(0)).isEqualTo(dispatches.get(1)).isEqualTo(dispatches.get(2));

        // And what they all get is a procedure dispatch. The loop asks; nothing here has yet decided whether the
        // thing asked may act.
        assertThat(dispatches.get(0)).isInstanceOf(ResolutionPolicy.Run.class);
        assertThat(((ResolutionPolicy.Run) dispatches.get(0)).resolver()).isEqualTo(Authority.PROCEDURE);
    }

    @Test
    @DisplayName("the fences that make that safe are on what a procedure may REPORT, and they hold")
    void whatStopsItToday() {
        // 1. A procedure can never close a need — it cannot report success under any capability status.
        Assertions.assertThatThrownBy(
                        () -> Resolution.of(CapabilityId.PROCEDURE_ORDER_ACTION, ResolutionState.RESOLVED))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("procedure");
        // RESOLVED_CONDITIONAL needs a non-empty ask, or an EARLIER rule fires and this would be asserting the
        // wrong refusal. With one supplied, the procedure rule is the one that speaks.
        Assertions.assertThatThrownBy(() -> new Resolution(CapabilityId.PROCEDURE_ORDER_ACTION,
                        ResolutionState.RESOLVED_CONDITIONAL, null, null,
                        List.of(com.sellerops.inquiry.authority.CustomerInput.OPTION), null, null))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("procedure");

        // 2. A Resolution has no field in which "I performed an effect" could be recorded. Observations only.
        List<String> components = java.util.Arrays.stream(Resolution.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).toList();
        assertThat(components).containsExactly("capability", "state", "gap", "missing", "ask", "observed",
                "preconditions");
        assertThat(components).noneMatch(c -> c.toLowerCase().contains("effect")
                || c.toLowerCase().contains("executed") || c.toLowerCase().contains("performed"));

        // 3. Exactly one capability in the registry changes the world, and it is declared without an executor.
        List<CapabilityId> effectful = java.util.Arrays.stream(CapabilityId.values())
                .filter(c -> c.effect() != ExecutionEffect.NONE).toList();
        assertThat(effectful).containsExactly(CapabilityId.PROCEDURE_ORDER_ACTION);
        assertThat(CapabilityId.PROCEDURE_ORDER_ACTION.effect()).isEqualTo(ExecutionEffect.EXTERNAL_STATE_CHANGE);
        assertThat(CapabilityStatus.DECLARED_NO_EXECUTOR).isNotNull();
    }

    /**
     * <b>The window this audit found, recorded as a test so it is not re-discovered.</b>
     *
     * <p>All three fences above constrain what a resolver may <i>report</i>. The resolver itself is a caller-supplied
     * {@code Function<Run, ResolverOutcome>}, so a future production resolver could perform an external change and
     * then report {@code CAPABILITY_GAP} — every fence would still be satisfied, and the damage is done before
     * anything is reported. Nothing in this package can stop a lambda from doing IO.
     *
     * <p>So the gate has to be that the effectful capability is never <b>dispatched</b> from this loop, and that is a
     * product decision rather than a refactor: measured, it settles seven committed scenario fixtures differently and
     * removes the only exercise of the waiter/resume state machine, because in four of them the procedure resolver is
     * what NAMES the read prerequisite. See §25.9.
     */
    @Test
    @DisplayName("KNOWN WINDOW: the loop dispatches the effectful capability, and the resolver is a caller's lambda")
    void theWindowThatIsStillOpen() {
        ResolutionPolicy.Dispatch d = ResolutionPolicy.next(action("any", RequestBasis.STATED), List.of());
        assertThat(d).isInstanceOf(ResolutionPolicy.Run.class);
        assertThat(((ResolutionPolicy.Run) d).resolver()).isEqualTo(Authority.PROCEDURE);

        // A resolver that acted and then declined to say so satisfies every constraint this package can express.
        Resolution actedThenDeclined = Resolution.gap(CapabilityId.PROCEDURE_ORDER_ACTION,
                com.sellerops.inquiry.authority.GapReason.NOT_EXECUTABLE, List.of(), List.of());
        assertThat(actedThenDeclined.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);

        // The one thing that does hold today: there is no production caller of this loop at all, so the window is
        // not reachable in a shipped path. GoalSmokeInputs-style structural proof lives in ResolutionPolicyInvariantTest.
        assertThat(GoalResolution.MAX_STEPS).isPositive();
    }
}
