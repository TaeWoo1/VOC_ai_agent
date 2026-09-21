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
        // not reachable in a shipped path. That is the fact the two tripwires below keep true.
        assertThat(GoalResolution.MAX_STEPS).isPositive();
    }

    // --- the tripwires -------------------------------------------------------------------------------------------
    //
    // Option B (§25.10): the structure stays as it is, because there is no executor and no production caller. The
    // risk that buys is a quiet one — somebody wires an executor later and the execution-approval seam is simply
    // never written, because nothing asked for it. These two tests are what asks. Neither invents an abstraction:
    // one reads the registry's own declaration, the other reads the source tree.

    /**
     * <b>Tripwire 1 — an effectful capability may not acquire an executor silently.</b>
     *
     * <p>Generic over the registry rather than naming the one capability that is effectful today, so a second one
     * inherits the tripwire the moment it declares an effect.
     */
    @Test
    @DisplayName("TRIPWIRE: every effectful capability is DECLARED_NO_EXECUTOR, in every snapshot the registry derives")
    void anEffectfulCapabilityCannotQuietlyGainAnExecutor() {
        List<CapabilityId> effectful = java.util.Arrays.stream(CapabilityId.values())
                .filter(c -> c.effect() != ExecutionEffect.NONE).toList();
        assertThat(effectful).as("nothing effectful in the registry would make this tripwire vacuous").isNotEmpty();

        for (String channel : new String[] {"NAVER", "CAFE24", "COUPANG", null}) {
            for (com.sellerops.order.fact.OrderFactLookup lookup
                    : com.sellerops.order.fact.OrderFactLookup.values()) {
                for (boolean bound : new boolean[] {true, false}) {
                    var snapshot = com.sellerops.inquiry.authority.CapabilityRegistry.derive(
                            new com.sellerops.inquiry.authority.CapabilityRegistry.Inputs(channel, null, bound,
                                    lookup, null, com.sellerops.inquiry.decision.DetailCapability.NOT_APPLICABLE,
                                    false, 0));
                    for (CapabilityId c : effectful) {
                        assertThat(snapshot.status(c))
                                .as("%s changes state outside this system. If it now has an executor, the execution "
                                        + "approval seam of docs/inquiry_architecture_v35.md §25.10 has to exist "
                                        + "FIRST — an ACTION goal is a model's reading of a sentence and is not "
                                        + "authorization. Do not simply update this expectation.", c)
                                .isEqualTo(CapabilityStatus.DECLARED_NO_EXECUTOR);
                    }
                }
            }
        }
    }

    /**
     * <b>Tripwire 2 — the resolution loop stays out of production until that seam exists.</b>
     *
     * <p>The window in {@link #theWindowThatIsStillOpen} is unreachable only because nothing shipped drives this
     * loop. That is a fact about the source tree, so the source tree is what is read. Javadoc is unaffected: the
     * existing mentions are {@code {@link com.sellerops.inquiry.goal.ResolutionPolicy}} references, and what is
     * searched for here is a call.
     */
    /**
     * The entry points a production caller would have to use to drive the loop.
     *
     * <p>Named once, because it was wrong: this list said {@code GoalSetResolution.resolve(} and the method is
     * {@code run}. The only occurrence of that string in the repository was this guard's own literal, so a
     * production class calling {@code GoalSetResolution.run(set, resolver)} would have tripped <b>nothing</b> —
     * the inner {@code GoalResolution.run(} call is inside the goal package, which the scan deliberately skips.
     * A source-scan guard that names a symbol which does not exist passes vacuously forever, and it passes
     * loudest on the day it was supposed to fire. {@link #theGuardedNamesExist()} is what stops that recurring.
     */
    private static final List<String> GUARDED_ENTRY_POINTS = List.of(
            "ResolutionPolicy.next(", "GoalResolution.run(", "GoalSetResolution.run(", "new CustomerGoalSet(");

    /**
     * <b>Every name the tripwire greps for must be a real symbol.</b>
     *
     * <p>This is the test the previous version needed and did not have. It does not read the source tree; it asks
     * the classes themselves, so a rename that empties the guard fails here rather than silently turning the guard
     * into a comment.
     */
    @Test
    @DisplayName("TRIPWIRE INTEGRITY: every guarded call names a method that actually exists")
    void theGuardedNamesExist() throws Exception {
        assertThat(ResolutionPolicy.class.getMethod("next", CustomerGoal.class, List.class)).isNotNull();
        assertThat(GoalResolution.class.getMethod("run", CustomerGoal.class, java.util.function.Function.class))
                .isNotNull();
        assertThat(GoalSetResolution.class.getMethod("run", CustomerGoalSet.class, java.util.function.Function.class))
                .isNotNull();
        assertThat(CustomerGoalSet.class.getConstructors()).isNotEmpty();

        // And the guard actually covers the public surface: every public static entry point on the two resolution
        // classes is named in the list, so adding a second way in cannot leave the window unguarded.
        for (Class<?> c : List.of(GoalResolution.class, GoalSetResolution.class, ResolutionPolicy.class)) {
            for (java.lang.reflect.Method m : c.getDeclaredMethods()) {
                if (!java.lang.reflect.Modifier.isPublic(m.getModifiers())
                        || !java.lang.reflect.Modifier.isStatic(m.getModifiers())) {
                    continue;
                }
                assertThat(GUARDED_ENTRY_POINTS)
                        .as("%s.%s is a public way into the loop and the tripwire does not watch it",
                                c.getSimpleName(), m.getName())
                        .contains(c.getSimpleName() + "." + m.getName() + "(");
            }
        }
    }

    /**
     * <b>The production driver, named — this is what "no production caller" became.</b>
     *
     * <p>The original assertion was {@code isEmpty()}, and it fired the day the loop was wired to real inquiries.
     * It was doing its job, but it was never the property worth keeping: "nobody drives the loop" is a fact about
     * today's callers, while {@link #theWindowThatIsStillOpen} names the fact about the <i>code</i> — that a
     * resolver is an arbitrary function, so it could act before it reports.
     *
     * <p>So the scan is narrowed rather than deleted, and the property it used to stand in for is asserted
     * directly, beside the driver, by {@code InquiryResolutionSafetyTest}: production supplies no resolver, the
     * resolver it does construct holds no collaborator it could call, and the effectful capability answers with one
     * constant across an exhaustive sweep. <b>A second driver still trips this</b>, because a second driver
     * inherits none of those guards.
     */
    @Test
    @DisplayName("TRIPWIRE: exactly one file in src/main drives the resolution loop, and it is the audited one")
    void theLoopHasOneAuditedProductionCaller() throws Exception {
        java.nio.file.Path main = java.nio.file.Path.of("src", "main", "java");
        List<String> callers = new ArrayList<>();
        try (var paths = java.nio.file.Files.walk(main)) {
            for (java.nio.file.Path p : paths.filter(java.nio.file.Files::isRegularFile)
                    .filter(f -> f.toString().endsWith(".java")).toList()) {
                if (p.toString().replace('\\', '/').contains("/com/sellerops/inquiry/goal/")) {
                    continue;   // the package may call itself
                }
                String body = java.nio.file.Files.readString(p);
                for (String call : GUARDED_ENTRY_POINTS) {
                    if (body.contains(call) && !callers.contains(p.getFileName().toString())) {
                        callers.add(p.getFileName().toString());
                    }
                }
            }
        }
        assertThat(callers)
                .as("a file other than the audited driver reaches the Customer Goal resolution loop. That driver "
                        + "supplies no resolver and constructs one that cannot act — a new caller inherits neither. "
                        + "Route it through InquiryGoalResolutionService, or give it the same guards FIRST: an "
                        + "ACTION goal is a model's reading of a sentence and is not authorization to act on an "
                        + "object. See docs/inquiry_architecture_v35.md §25.10 and InquiryResolutionSafetyTest.")
                .containsExactly("InquiryGoalResolutionService.java");
    }

    /**
     * <b>The replacement exists.</b>
     *
     * <p>Narrowing a guard is only safe if the thing it stopped standing in for is asserted somewhere else. This
     * reads for that somewhere else by name, so deleting it cannot quietly leave the window unwatched — the same
     * defect class {@link #theGuardedNamesExist()} closed for the scan's own literals.
     */
    @Test
    @DisplayName("TRIPWIRE INTEGRITY: the guard that replaced «no production caller» is present and asserts it")
    void theReplacementGuardExists() throws Exception {
        java.nio.file.Path guard = java.nio.file.Path.of("src", "test", "java",
                "com/sellerops/inquiry/resolve/InquiryResolutionSafetyTest.java");
        assertThat(java.nio.file.Files.exists(guard))
                .as("%s is the narrowing's other half. Without it, this file's scan permits a production driver "
                        + "and nothing checks what that driver does.", guard)
                .isTrue();
        String body = java.nio.file.Files.readString(guard);
        assertThat(body).contains("theDriverTakesObjectsNotFunctions");
        assertThat(body).contains("theResolverIsPure");
        assertThat(body).contains("theEffectfulCapabilityIsAConstant");
    }
}
