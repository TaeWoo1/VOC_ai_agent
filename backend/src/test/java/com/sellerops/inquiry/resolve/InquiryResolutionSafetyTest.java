package com.sellerops.inquiry.resolve;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.authority.ExecutionEffect;
import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.ListingState;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.authority.ResolutionState;
import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.inquiry.goal.CustomerGoal;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.GoalResolution;
import com.sellerops.inquiry.goal.GoalSetResolution;
import com.sellerops.inquiry.goal.Referent;
import com.sellerops.inquiry.goal.RequestBasis;
import com.sellerops.inquiry.goal.RequestedOutcome;
import com.sellerops.inquiry.goal.ResolverOutcome;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.order.fact.OrderFactState;
import java.lang.reflect.Constructor;
import java.lang.reflect.Executable;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The guard that replaced "the loop has no production caller"</b> (Inquiry v3.5 §25.10).
 *
 * <p>That tripwire was true and it is not true any more: {@link InquiryGoalResolutionService} drives the loop from
 * {@code src/main}. It was never the real property, only the cheapest way to get it — the window it described is
 * that {@link GoalSetResolution#run} takes a <b>caller-supplied function</b>, so a resolver could perform an
 * external effect and then report a gap, and every fence in the goal package would still be satisfied because they
 * all constrain what a resolver may <i>report</i>.
 *
 * <p>So this asserts the property directly, in four parts. Each one fails on its own; none of them is satisfied by
 * the others.
 *
 * <ol>
 *   <li><b>Production supplies no resolver.</b> The entry points take objects. There is no parameter through which
 *       a different resolver could arrive, so "a caller's lambda" is not a shape production has.</li>
 *   <li><b>The resolver cannot act.</b> {@link InquiryGoalResolvers} holds no state and names no repository,
 *       client, writer or executor. It cannot read or change anything; it reads a record it was handed.</li>
 *   <li><b>The effectful capability returns a constant.</b> Swept over every goal shape and every context shape,
 *       the procedure branch is one and the same {@link Resolution}, and the goal terminates on it.</li>
 *   <li><b>There is still exactly one driver.</b> The source scan survives, narrowed: a <i>second</i> production
 *       caller trips it exactly as the original did.</li>
 * </ol>
 */
class InquiryResolutionSafetyTest {

    private static final Path MAIN = Path.of("src", "main", "java");
    private static final Path DRIVER =
            MAIN.resolve("com/sellerops/inquiry/resolve/InquiryGoalResolutionService.java");
    private static final Path RESOLVERS = MAIN.resolve("com/sellerops/inquiry/resolve/InquiryGoalResolvers.java");

    // --- 1. production supplies no resolver -----------------------------------------------------------------------

    @Test
    @DisplayName("GUARD: no production entry point accepts a resolver — a caller cannot supply one")
    void theDriverTakesObjectsNotFunctions() {
        List<Executable> surface = new ArrayList<>();
        for (Method m : InquiryGoalResolutionService.class.getDeclaredMethods()) {
            if (Modifier.isPublic(m.getModifiers())) {
                surface.add(m);
            }
        }
        for (Constructor<?> c : InquiryGoalResolutionService.class.getConstructors()) {
            surface.add(c);
        }
        assertThat(surface).as("a driver with no public surface would make this vacuous").isNotEmpty();

        for (Executable e : surface) {
            for (Class<?> parameter : e.getParameterTypes()) {
                assertThat(parameter.isInterface() && parameter.getName().startsWith("java.util.function."))
                        .as("%s.%s takes %s. A resolver that arrives as a parameter is the window §25.10 named: "
                                + "nothing in the goal package can stop a lambda from doing IO before it reports. "
                                + "Production must construct the resolver, not accept one.",
                                InquiryGoalResolutionService.class.getSimpleName(), e.getName(),
                                parameter.getSimpleName())
                        .isFalse();
            }
        }
    }

    @Test
    @DisplayName("GUARD: the driver resolves with InquiryGoalResolvers and nothing else")
    void theDriverNamesTheOneResolver() throws Exception {
        String body = Files.readString(DRIVER);
        assertThat(body).contains("GoalSetResolution.run(");
        assertThat(body).as("the one resolver the driver may use").contains("InquiryGoalResolvers.resolve(");
        // Every occurrence of the loop entry point is on the line that hands it the in-tree resolver.
        for (String line : body.split("\n")) {
            if (line.contains("GoalSetResolution.run(")) {
                assertThat(line).as("a loop entry that does not name the in-tree resolver: %s", line.strip())
                        .contains("InquiryGoalResolvers");
            }
        }
    }

    // --- 2. the resolver cannot act -------------------------------------------------------------------------------

    /**
     * The names a resolver would have to say in order to read or change anything.
     *
     * <p>This is a list of <b>collaborator kinds</b>, not of today's classes: a resolver that acquires any of them
     * has stopped being a function of its context, and that is the change this guard exists to catch — whichever
     * class it is.
     */
    private static final List<String> CANNOT_APPEAR = List.of(
            "Repository", "Client", "Connector", "Executor", "RestTemplate", "WebClient", "HttpClient",
            "Publisher", "publish", "execute(", "send(", "save(", "delete(", "Adapter", "Template");

    @Test
    @DisplayName("GUARD: the resolver holds no state and names no collaborator that could read or act")
    void theResolverIsPure() throws Exception {
        assertThat(Modifier.isFinal(InquiryGoalResolvers.class.getModifiers())).isTrue();
        assertThat(InquiryGoalResolvers.class.getDeclaredFields())
                .as("a field is a collaborator, and a collaborator is something this class could call")
                .allMatch(f -> Modifier.isStatic(f.getModifiers()) && Modifier.isFinal(f.getModifiers()));
        for (Constructor<?> c : InquiryGoalResolvers.class.getDeclaredConstructors()) {
            assertThat(Modifier.isPrivate(c.getModifiers())).isTrue();
        }

        String source = Files.readString(RESOLVERS);
        String code = withoutComments(source);
        for (String forbidden : CANNOT_APPEAR) {
            assertThat(code)
                    .as("%s appears in the resolver. It answers a dispatch from the context it was handed; the "
                            + "moment it can reach anything else, 'the resolver cannot act' stops being true and "
                            + "the effectful dispatch stops being safe.", forbidden)
                    .doesNotContain(forbidden);
        }
    }

    // --- 3. the effectful capability returns a constant ------------------------------------------------------------

    @Test
    @DisplayName("GUARD: every effectful dispatch returns the same inert resolution, whatever it is handed")
    void theEffectfulCapabilityIsAConstant() {
        List<CapabilityId> effectful = java.util.Arrays.stream(CapabilityId.values())
                .filter(c -> c.effect() != ExecutionEffect.NONE).toList();
        assertThat(effectful).as("nothing effectful would make this vacuous").isNotEmpty();

        Set<String> reported = new LinkedHashSet<>();
        int dispatches = 0;
        for (InquiryResolutionContext ctx : contexts()) {
            for (CustomerGoal goal : goals()) {
                GoalResolution.Trace trace = GoalResolution.run(goal,
                        run -> InquiryGoalResolvers.resolve(goal, run, ctx));
                long effectfulSteps = 0;
                for (ResolverOutcome outcome : trace.observed()) {
                    if (outcome.resolution().capability().effect() == ExecutionEffect.NONE) {
                        continue;
                    }
                    dispatches++;
                    effectfulSteps++;
                    reported.add(describe(outcome));
                    assertThat(outcome.prerequisite())
                            .as("an effectful dispatch that names a precondition has a second visit, and a second "
                                    + "visit is a place for a branch")
                            .isNull();
                }
                assertThat(effectfulSteps)
                        .as("an effectful capability is dispatched at most once per goal").isLessThanOrEqualTo(1);
                if (effectfulSteps > 0) {
                    // A goal that touched the effectful capability never closes. A goal that never touched it may
                    // close perfectly well — that is what the knowledge and entity resolvers are for.
                    assertThat(trace.state())
                            .as("a goal that reached the effectful capability closed on it, subject=%s outcome=%s",
                                    goal.subject(), goal.requestedOutcome())
                            .isNotIn(ResolutionState.RESOLVED, ResolutionState.RESOLVED_CONDITIONAL);
                }
            }
        }
        assertThat(dispatches).as("the sweep must actually reach the effectful capability").isPositive();
        assertThat(reported)
                .as("the effectful branch answered differently depending on its input, so it has a decision in it. "
                        + "It is allowed exactly one answer: CAPABILITY_GAP / NOT_EXECUTABLE, with nothing observed.")
                .containsExactly("PROCEDURE.ORDER_ACTION CAPABILITY_GAP NOT_EXECUTABLE observed=0 ask=0");
    }

    @Test
    @DisplayName("GUARD: an ACTION goal terminates NOT_EXECUTABLE for every referent that admits a procedure")
    void everyActionTerminatesInert() {
        for (InquiryResolutionContext ctx : contexts()) {
            for (Referent subject : Referent.values()) {
                CustomerGoal goal = new CustomerGoal("g", "요청", RequestedOutcome.ACTION, subject,
                        RequestBasis.STATED, List.of(), "요청");
                GoalResolution.Trace trace = GoalResolution.run(goal,
                        run -> InquiryGoalResolvers.resolve(goal, run, ctx));
                assertThat(trace.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
                assertThat(trace.gap()).as("subject=%s", subject)
                        .isIn(GapReason.NOT_EXECUTABLE, GapReason.NOT_SUPPORTED, GapReason.UNBOUND);
            }
        }
    }

    // --- 4. exactly one production driver --------------------------------------------------------------------------

    /** The entry points a production caller would have to use to drive the loop. Mirrors the goal package's list. */
    private static final List<String> GUARDED_ENTRY_POINTS = List.of(
            "ResolutionPolicy.next(", "GoalResolution.run(", "GoalSetResolution.run(", "new CustomerGoalSet(");

    @Test
    @DisplayName("GUARD: exactly one file in src/main drives the loop, and it is the audited one")
    void thereIsExactlyOneDriver() throws Exception {
        List<String> drivers = new ArrayList<>();
        try (var paths = Files.walk(MAIN)) {
            for (Path p : paths.filter(Files::isRegularFile)
                    .filter(f -> f.toString().endsWith(".java")).toList()) {
                String normalized = p.toString().replace('\\', '/');
                if (normalized.contains("/com/sellerops/inquiry/goal/")) {
                    continue;   // the package may call itself
                }
                String body = withoutComments(Files.readString(p));
                if (GUARDED_ENTRY_POINTS.stream().anyMatch(body::contains)) {
                    drivers.add(p.getFileName().toString());
                }
            }
        }
        assertThat(drivers)
                .as("a second production driver of the resolution loop. The audited one supplies no resolver and "
                        + "cannot act (the guards above); a new one inherits none of that. Either route it through "
                        + "InquiryGoalResolutionService, or give it its own guards FIRST — see §25.10.")
                .containsExactly("InquiryGoalResolutionService.java");
    }

    // --- the sweep -------------------------------------------------------------------------------------------------

    private static String describe(ResolverOutcome outcome) {
        Resolution r = outcome.resolution();
        return r.capability().wire() + " " + r.state() + " " + r.gap()
                + " observed=" + r.observed().size() + " ask=" + r.ask().size();
    }

    /** Contexts spanning the axes a resolver could branch on: binding, channel, lookup reach, what was searched. */
    private static List<InquiryResolutionContext> contexts() {
        List<InquiryResolutionContext> out = new ArrayList<>();
        UUID org = UUID.randomUUID();
        UUID product = UUID.randomUUID();
        for (String channel : new String[] {"NAVER", "CAFE24", null}) {
            for (OrderFactLookup lookup : OrderFactLookup.values()) {
                for (boolean bound : new boolean[] {true, false}) {
                    for (RetrievalOutcome found : RetrievalOutcome.values()) {
                        CapabilitySnapshot snapshot = CapabilityRegistry.derive(new CapabilityRegistry.Inputs(
                                channel, null, bound, lookup, bound ? product : null,
                                DetailCapability.NOT_APPLICABLE, bound, bound ? 2 : 0));
                        Map<CapabilityId, RetrievalOutcome> knowledge = new EnumMap<>(CapabilityId.class);
                        knowledge.put(CapabilityId.KNOWLEDGE_PRODUCT, found);
                        knowledge.put(CapabilityId.KNOWLEDGE_ORG, found);
                        out.add(new InquiryResolutionContext(org, UUID.randomUUID(), bound ? product : null,
                                bound ? "order-1" : null,
                                bound ? new OrderFact(OrderFactState.OBSERVED_FRESH, null, null, channel, null, null,
                                        null, null, null, null, null, null, Instant.now()) : null,
                                new ListingState(bound ? product : null, null, null, List.of()),
                                snapshot, knowledge, lookup, Instant.now()));
                    }
                }
            }
        }
        return out;
    }

    private static List<CustomerGoal> goals() {
        List<CustomerGoal> out = new ArrayList<>();
        for (RequestedOutcome outcome : RequestedOutcome.values()) {
            for (Referent subject : Referent.values()) {
                for (RequestBasis basis : RequestBasis.values()) {
                    out.add(new CustomerGoal("g", "요청", outcome, subject, basis, List.of(), "요청"));
                }
            }
        }
        return out;
    }

    /** Strips comments, so a guard cannot be tripped — or satisfied — by prose about itself. */
    private static String withoutComments(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)^\\s*//.*$", "");
    }

    /**
     * <b>Exactly one thing reads a sentence into goals, and it is the audited one.</b>
     *
     * <p>This guard used to assert <i>zero</i> implementations, and that was true until the interpreter shipped.
     * It was never the property worth keeping — the property is that reading a customer's sentence into goals is
     * a <b>metered, keyed, named-organisations-only capability</b>, not something a class can start doing. So the
     * count is narrowed to one rather than dropped: a second implementation is a second way into the resolution
     * loop, and it inherits none of the store, the quota or the access gate that the first one goes through.
     */
    @Test
    @DisplayName("GUARD: exactly one production class reads a sentence into goals, and it is off by default")
    void oneAuditedReaderOfSentences() throws Exception {
        List<String> implementations = new ArrayList<>();
        try (var paths = Files.walk(MAIN)) {
            for (Path p : paths.filter(Files::isRegularFile)
                    .filter(f -> f.toString().endsWith(".java")).toList()) {
                if (p.getFileName().toString().equals("CustomerGoalInterpretation.java")) {
                    continue;
                }
                if (withoutComments(Files.readString(p)).contains("implements CustomerGoalInterpretation")) {
                    implementations.add(p.getFileName().toString());
                }
            }
        }
        assertThat(implementations)
                .as("a second class turns customers' sentences into goals. The audited one is metered, keyed, "
                        + "stored once per message and admitted only for named organisations; a new one inherits "
                        + "none of that. Route it through StoredCustomerGoalInterpretation, or give it the same "
                        + "gates FIRST — see the interface's javadoc.")
                .containsExactly("StoredCustomerGoalInterpretation.java");

        // And it is off unless a deployment says otherwise, in the file that owns the switch.
        String yml = Files.readString(Path.of("src", "main", "resources", "application.yml"));
        assertThat(yml).contains("enabled: ${SELLEROPS_INQUIRY_GOAL_ENABLED:false}");
        assertThat(yml).contains("enabled-org-ids: ${SELLEROPS_INQUIRY_GOAL_ORG_IDS:}");
        assertThat(yml).contains("api-key: ${SELLEROPS_INQUIRY_GOAL_API_KEY:}");
    }

    /**
     * <b>The reader is reached from the case runtime, and from nothing a seller's screen calls.</b>
     *
     * <p>«Ask once» is a property of the store, but «a read never asks» has to be a property of the call graph:
     * a Home page that interpreted on render would spend a seller's budget on scrolling, and could change a
     * conclusion between two looks at the same case.
     */
    @Test
    @DisplayName("GUARD: no read surface can reach the interpretation")
    void readSurfacesDoNotInterpret() throws Exception {
        List<String> readers = List.of("CustomerOperationsHomeService.java", "CustomerOperationsHomeController.java",
                "InquiryProposalService.java", "ProactiveCaseService.java");
        List<String> offenders = new ArrayList<>();
        try (var paths = Files.walk(MAIN)) {
            for (Path p : paths.filter(Files::isRegularFile).toList()) {
                if (!readers.contains(p.getFileName().toString())) {
                    continue;
                }
                String code = withoutComments(Files.readString(p));
                if (code.contains("CustomerGoalInterpretation") || code.contains("CaseResolutionReader")
                        || code.contains("InquiryGoalService")) {
                    offenders.add(p.getFileName().toString());
                }
            }
        }
        assertThat(offenders).as("a seller's read now reaches the goal interpreter").isEmpty();
    }

    @Test
    @DisplayName("GUARD: a resolution can never auto-resolve a customer's question")
    void aResolutionNeverClosesACaseByItself() {
        for (InquiryResolutionContext ctx : contexts()) {
            for (CustomerGoal goal : goals()) {
                var outcome = InquiryGoalResolutionService.resolve(
                        new CustomerGoalSet(List.of(goal), List.of()), ctx);
                var reading = com.sellerops.operationscase.CaseFromResolution.of(
                        com.sellerops.inquiry.resolve.InquiryResolutionView.of(outcome));
                assertThat(reading).isNotNull();
                assertThat(reading.disposition())
                        .as("a goal the company's knowledge answers is not a customer who has been answered; the "
                                + "reply still has to be written, approved and sent")
                        .isNotEqualTo(com.sellerops.operationscase.CaseDisposition.AUTO_RESOLVED);
            }
        }
    }

    @Test
    @DisplayName("the set-level driver refuses a null context rather than resolving about nothing")
    void aContextlessSetIsRefused() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                        InquiryGoalResolutionService.resolve(new CustomerGoalSet(List.of(), List.of()), null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
