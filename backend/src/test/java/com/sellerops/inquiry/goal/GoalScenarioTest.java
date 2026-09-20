package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.AuthorityProvenance;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.ObservedField;
import com.sellerops.inquiry.decision.EvidenceScope;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.authority.ResolutionState;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * <b>The twelve shapes the architecture has to get right</b> (Inquiry v3.5 §18).
 *
 * <p>Each row scripts what the resolvers observe and asserts two things: <b>which resolvers were actually asked</b>,
 * in order, and where the goal ended. The first of those is the one that matters — the Resolution Planner's failures
 * were all visible as a resolver being consulted that the customer's message never called for.
 *
 * <p>{@code forbidden_dispatch} is asserted as strongly as the expectation: for {@code G05} and {@code G06} the
 * procedure registry must not be consulted <b>at all</b>, and that is now a property of {@link ResolutionPolicy}'s
 * shape rather than a sentence in a prompt that was measured twice and held neither time.
 */
class GoalScenarioTest {

    private static final Path SCENARIOS = Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic",
            "goal-scenarios.jsonl");
    private static final ObjectMapper JSON = new ObjectMapper();

    static Stream<JsonNode> scenarios() throws Exception {
        List<JsonNode> rows = new ArrayList<>();
        for (String line : Files.readAllLines(SCENARIOS)) {
            if (!line.isBlank()) {
                rows.add(JSON.readTree(line));
            }
        }
        assertThat(rows).as("the fixture is the contract; an empty one proves nothing").hasSize(12);
        return rows.stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("scenarios")
    void scenario(JsonNode row) {
        Deque<JsonNode> script = new ArrayDeque<>();
        row.get("script").forEach(script::add);
        List<Authority> asked = new ArrayList<>();

        GoalResolution.Trace last = null;
        for (JsonNode g : row.get("goals")) {
            last = GoalResolution.run(goal(g), run -> {
                asked.add(run.resolver());
                JsonNode step = script.poll();
                assertThat(step).as("%s: a resolver was asked and the fixture scripts no answer", row.get("id")).isNotNull();
                assertThat(run.resolver().name())
                        .as("%s: the loop asked a different resolver than the fixture scripts", row.get("id"))
                        .isEqualTo(step.get("authority").asText());
                return outcome(step);
            });
        }

        String id = row.get("id").asText();
        List<String> dispatched = asked.stream().map(Enum::name).toList();
        List<String> expected = new ArrayList<>();
        row.get("expect").get("dispatch").forEach(n -> expected.add(n.asText()));
        assertThat(dispatched).as("%s: which resolvers were asked, in order", id).isEqualTo(expected);

        for (JsonNode f : row.get("forbidden_dispatch")) {
            assertThat(dispatched).as("%s: %s must never be consulted for this message", id, f.asText())
                    .doesNotContain(f.asText());
        }

        assertThat(script).as("%s: the fixture scripted an answer nobody asked for", id).isEmpty();
        assertThat(last).isNotNull();
        assertThat(last.state().name()).as("%s: terminal", id).isEqualTo(row.get("expect").get("terminal").asText());
        JsonNode gap = row.get("expect").get("gap");
        assertThat(last.gap()).as("%s: gap reason", id)
                .isEqualTo(gap == null ? null : GapReason.valueOf(gap.asText()));
        assertThat(last.phase()).isEqualTo(GoalResolution.Phase.SETTLED);

        JsonNode ask = row.get("expect").get("ask");
        if (ask != null) {
            List<String> named = new ArrayList<>();
            ask.forEach(a -> named.add(a.asText()));
            assertThat(last.observed().get(last.observed().size() - 1).resolution().ask())
                    .as("%s: the RESOLVER named the customer input, and nothing upstream did", id)
                    .extracting(Enum::name).isEqualTo(named);
        }
    }

    @Test
    @DisplayName("G05 and G06 differ from G07 by the customer's sentence, not by a rule about exchanges")
    void theDecisionActionBoundaryIsNotDomainKnowledge() throws Exception {
        List<JsonNode> rows = scenarios().toList();
        JsonNode g06 = rows.stream().filter(r -> r.get("id").asText().equals("G06")).findFirst().orElseThrow();
        JsonNode g07 = rows.stream().filter(r -> r.get("id").asText().equals("G07")).findFirst().orElseThrow();
        // Same subject, same domain, same registry. One goal against two, and only G07 may reach a procedure.
        assertThat(g06.get("goals")).hasSize(1);
        assertThat(g07.get("goals")).hasSize(2);
        assertThat(g06.get("goals").get(0).get("subject").asText())
                .isEqualTo(g07.get("goals").get(0).get("subject").asText());
        assertThat(RequestedOutcome.DECISION.mayReachProcedure()).isFalse();
        assertThat(RequestedOutcome.ACTION.mayReachProcedure()).isTrue();
    }

    @Test
    @DisplayName("the record has no slot for a plan — the forbidden outputs are absent, not validated against")
    void whatAGoalCannotCarry() {
        List<String> components = Stream.of(CustomerGoal.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).toList();
        assertThat(components)
                .containsExactly("id", "explicitRequest", "requestedOutcome", "subject", "basis", "explicitConstraints");
        // Each of these was a measured failure when the model owned it. None of them has anywhere to go.
        assertThat(components).doesNotContain("fields", "customerInputs", "steps", "capabilities", "procedure",
                "fallback", "handoff", "closingAuthority", "availability", "effect", "scope");
    }

    @Test
    @DisplayName("an explicit request is a request; a plan does not fit in one")
    void requestIsBounded() {
        assertThatThrownBy(() -> new CustomerGoal("g1", "x".repeat(CustomerGoal.MAX_REQUEST + 1),
                RequestedOutcome.INFORMATION, Referent.CURRENT_LISTING, RequestBasis.STATED, List.of()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new CustomerGoal("g1", "소재가 뭔가요?", RequestedOutcome.INFORMATION,
                Referent.CURRENT_LISTING, RequestBasis.STATED, List.of("x".repeat(CustomerGoal.MAX_CONSTRAINT + 1))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static CustomerGoal goal(JsonNode g) {
        List<String> constraints = new ArrayList<>();
        g.get("explicit_constraints").forEach(c -> constraints.add(c.asText()));
        return new CustomerGoal(g.get("id").asText(), g.get("explicit_request").asText(),
                RequestedOutcome.valueOf(g.get("requested_outcome").asText()),
                Referent.valueOf(g.get("subject").asText()), RequestBasis.valueOf(g.get("basis").asText()),
                constraints);
    }

    private static ResolverOutcome outcome(JsonNode step) {
        CapabilityId capability = CapabilityId.ofWire(step.get("capability").asText());
        ResolutionState state = ResolutionState.valueOf(step.get("state").asText());
        JsonNode gap = step.get("gap");
        JsonNode ask = step.get("ask");
        List<CustomerInput> inputs = new ArrayList<>();
        if (ask != null) {
            ask.forEach(a -> inputs.add(CustomerInput.valueOf(a.asText())));
        }
        List<ObservedField> observed = new ArrayList<>();
        JsonNode seen = step.get("observed");
        if (seen != null) {
            // A fresh observation, because Resolution refuses to let entity state close a goal without one. That rule
            // predates this package and is not relaxed for a fixture.
            AuthorityProvenance provenance = new AuthorityProvenance(capability, EvidenceScope.order("ORDER-1"),
                    AuthorityProvenance.Source.ORDER_EXACT_READ, Instant.EPOCH, AuthorityProvenance.Freshness.FRESH);
            seen.forEach(f -> observed.add(new ObservedField(EntityField.valueOf(f.asText()), "SHIPPED", provenance)));
        }
        Resolution resolution = new Resolution(capability, state,
                gap == null ? null : GapReason.valueOf(gap.asText()), null, inputs, observed, null);
        JsonNode prerequisite = step.get("prerequisite");
        return prerequisite == null ? ResolverOutcome.of(resolution)
                : ResolverOutcome.needs(resolution, CapabilityId.ofWire(prerequisite.asText()));
    }
}
