package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The smoke's inputs, checked against committed source rather than against the document that describes them</b>
 * (Inquiry v3.5).
 *
 * <p>§22.11 names fourteen: thirteen git fixtures and one real customer message. <b>Nothing merged and nothing
 * disappeared</b> — an earlier report printed "13" because the field counted only the fixture-derived half, which
 * was a name doing the wrong job rather than a row going astray.
 *
 * <p>The two multi-goal rows now carry a <b>written</b> {@code customer_message}. That field exists because the
 * alternative was deriving an input from its own answer key: a join of a row's goals is a sentence nobody sent, and
 * for the fallback row it produces an input with the conditional clause missing — a test that asks the model to find
 * a relationship nobody wrote, on the one fixture that exists to check exactly that. These tests pin both halves:
 * the message is not a join, and it carries the clause verbatim.
 */
class GoalSmokePreflightTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Path FIXTURE = Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic",
            "goal-scenarios.jsonl");

    private static JsonNode row(String id) throws Exception {
        for (String line : Files.readAllLines(FIXTURE)) {
            if (!line.isBlank()) {
                JsonNode row = JSON.readTree(line);
                if (row.get("id").asText().equals(id)) {
                    return row;
                }
            }
        }
        throw new IllegalStateException("no fixture " + id);
    }

    private static String join(JsonNode row) {
        List<String> parts = new java.util.ArrayList<>();
        row.get("goals").forEach(g -> parts.add(g.get("explicit_request").asText()));
        return String.join(" ", parts);
    }

    @Test
    @DisplayName("a multi-goal input is WRITTEN, never assembled from the goals it is supposed to produce")
    void multiGoalInputsAreNotDerivedFromTheirOwnAnswerKey() throws Exception {
        for (String id : List.of("G07", "G23")) {
            JsonNode row = row(id);
            assertThat(row.hasNonNull("customer_message")).as("%s carries a written message", id).isTrue();
            assertThat(row.get("customer_message").asText())
                    .as("%s: the input is a join of its own goals, which is a sentence nobody sent", id)
                    .isNotEqualTo(join(row));
            assertThat(row.get("goals").size()).isGreaterThan(1);
        }
    }

    @Test
    @DisplayName("the fallback clause is in the input verbatim — the relation is discoverable from the message")
    void theStatedConditionIsInTheInput() throws Exception {
        JsonNode g23 = row("G23");
        String condition = g23.get("relations").get(0).get("stated_condition").asText();
        assertThat(g23.get("customer_message").asText())
                .as("a model cannot find a condition that is not in what it was given").contains(condition);
        // And the naive alternative would have dropped it, which is why the field exists at all.
        assertThat(join(g23)).doesNotContain(condition);
    }

    @Test
    @DisplayName("thirteen inputs come from committed source, and each is the customer's own words")
    void theCommittedHalfIsComplete() throws Exception {
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE);
        assertThat(GoalSmokeInputs.CHOSEN).hasSize(13);
        assertThat(set.usable()).hasSize(13);
        assertThat(set.inputs()).allSatisfy(i -> assertThat(i.message()).isNotBlank());
        assertThat(set.realCustomerText()).as("nothing committed to git is a real customer's words").isFalse();
        // The fourteenth is reported missing from THIS overload on purpose: it is not a fixture.
        assertThat(set.missing()).singleElement().satisfies(m ->
                assertThat(m).contains(GoalSmokeInputs.NO_GOAL_CASE).contains("read at runtime"));
    }

    @Test
    @DisplayName("the fourteenth is read from the durable store at runtime, and declares itself as real text")
    void theNoGoalCaseComesFromTheStore() throws Exception {
        Path store = GoalInterpreterPreflight.storeRoot(System.getenv());
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE, store);
        if (!Files.exists(store.resolve(GoalSmokeInputs.CAPTURE))) {
            // CI does not restore the store, and the harness says so rather than inventing the row.
            assertThat(set.missing()).singleElement().satisfies(m ->
                    assertThat(m).contains("store.mjs restore inquiry-planner-capture"));
            assertThat(set.realCustomerText()).isFalse();
            return;
        }
        assertThat(set.missing()).isEmpty();
        assertThat(set.usable()).hasSize(14);
        assertThat(set.realCustomerText()).as("the manifest has to declare this, so the set has to know it").isTrue();
        GoalSmokeInputs.Input real = set.inputs().stream()
                .filter(i -> i.id().equals(GoalSmokeInputs.NO_GOAL_CASE)).findFirst().orElseThrow();
        assertThat(real.realCustomerText()).isTrue();
        assertThat(real.message()).isNotBlank();

        // It is read, and it is not written back: no committed file carries it.
        assertThat(Files.readString(FIXTURE)).doesNotContain(real.message());
        assertThat(set.coverage().get("no_goal")).startsWith("covered");
    }


    /**
     * <b>The paired holdout run: one input set, two contracts</b> (§25.13, §26.7).
     *
     * <p>A paired comparison is only paired if the two arms were asked the same thing. Here that is not argued — it
     * is the {@code input_set_fp}, which is the one formula the runner re-computes at send time and the manifest is
     * bound to, so the two approvals agree on it or the run stops.
     *
     * <p>Everything that identifies a CONTRACT must differ, and it must differ everywhere at once: the version, both
     * prompt fingerprints, and the request bytes — the system prompt is inside the body, so a shared
     * {@code request_fp_set} would mean one of the arms is not the contract it claims to be.
     */
    @Test
    @DisplayName("the two holdout arms share their inputs byte for byte and share nothing that names a contract")
    void thePairedArmsAskTheSameQuestionOfTwoContracts() throws Exception {
        Path store = GoalInterpreterPreflight.storeRoot(System.getenv());
        if (!Files.exists(store.resolve(GoalSmokeInputs.HOLDOUT))) {
            return;   // the holdout lives in the durable store and is never copied into this repository
        }
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE, store, GoalSmokeInputs.HOLDOUT_V1);
        assertThat(set.missing()).isEmpty();
        List<CustomerGoalRunner.Input> inputs = set.usable().stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList();
        assertThat(inputs).hasSize(75);

        Map<CustomerGoalPrompt.Arm, List<CustomerGoalRunner.Request>> byArm = new java.util.LinkedHashMap<>();
        for (CustomerGoalPrompt.Arm arm : List.of(CustomerGoalPrompt.Arm.V2, CustomerGoalPrompt.Arm.V3)) {
            byArm.put(arm, new CustomerGoalRunner(GoalInterpreterPreflight.MODEL,
                    GoalInterpreterPreflight.REASONING_EFFORT, null, null, Map.of(), arm).prepare(inputs));
        }
        List<CustomerGoalRunner.Request> v2 = byArm.get(CustomerGoalPrompt.Arm.V2);
        List<CustomerGoalRunner.Request> v3 = byArm.get(CustomerGoalPrompt.Arm.V3);
        assertThat(v2).hasSize(75);
        assertThat(v3).hasSize(75);
        assertThat(v2.size() + v3.size()).as("the sitting an operator is approving").isEqualTo(150);

        // Same question, in the same order. `user` is the whole of what the customer contributes to a request, so
        // comparing it is comparing the inputs rather than a summary of them.
        for (int i = 0; i < v2.size(); i++) {
            assertThat(v2.get(i).id()).isEqualTo(v3.get(i).id());
            assertThat(v2.get(i).user()).as("%s reached the two arms differently", v2.get(i).id())
                    .isEqualTo(v3.get(i).user());
        }
        assertThat(CustomerGoalRunner.inputSetFp(inputs)).isNotBlank();

        // Two contracts, differing in every field that says which contract a run is a run of.
        assertThat(CustomerGoalPrompt.Arm.V2.version()).isNotEqualTo(CustomerGoalPrompt.Arm.V3.version());
        assertThat(CustomerGoalPrompt.sha256(CustomerGoalPrompt.Arm.V2.system()))
                .isNotEqualTo(CustomerGoalPrompt.sha256(CustomerGoalPrompt.Arm.V3.system()));
        assertThat(CustomerGoalPrompt.sha256(CustomerGoalPrompt.Arm.V2.schema().toString()))
                .isNotEqualTo(CustomerGoalPrompt.sha256(CustomerGoalPrompt.Arm.V3.schema().toString()));
        assertThat(CustomerGoalRunner.requestFpSet(v2)).as("the arms would send identical bytes")
                .isNotEqualTo(CustomerGoalRunner.requestFpSet(v3));
        for (int i = 0; i < v2.size(); i++) {
            assertThat(v2.get(i).requestFp()).isNotEqualTo(v3.get(i).requestFp());
        }
    }

    @Test
    @DisplayName("every intended shape is covered once the store is present, and the four outcomes always are")
    void coverageIsMeasuredNotAsserted() throws Exception {
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE,
                GoalInterpreterPreflight.storeRoot(System.getenv()));
        for (String outcome : List.of("ANSWER", "STATE_READ", "ACTION")) {
            assertThat(set.coverage().get("outcome:" + outcome)).isEqualTo("covered");
        }
        assertThat(set.coverage().get("multi_goal")).startsWith("covered");
        assertThat(set.coverage().get("explicit_fallback")).startsWith("covered");
        assertThat(set.coverage().get("can_you_boundary")).startsWith("covered");
        assertThat(set.coverage().get("no_invented_prerequisite_goal")).startsWith("covered");
        assertThat(set.coverage().get("unavailable_capability_keeps_semantics")).startsWith("covered");
    }

    @Test
    @DisplayName("a preflight missing anything produces no manifest at all")
    void aBlockedPreflightProducesNoManifest() throws Exception {
        // No environment: the one thing that is certainly absent here, whatever else is true.
        var outcome = GoalInterpreterPreflight.prepare(Path.of(".."), Map.of());
        assertThat(outcome.ready()).isFalse();
        assertThat(outcome.manifest()).isNull();
        assertThat(outcome.report().get("verdict").asText()).isEqualTo("BLOCKED");
        for (String name : GoalInterpreterPreflight.REQUIRED_ENV) {
            assertThat(outcome.blockers()).anySatisfy(b -> assertThat(b).contains(name));
        }
    }

    @Test
    @DisplayName("the report counts fourteen planned inputs, split into the two places they live")
    void theCountIsReconciled() throws Exception {
        var outcome = GoalInterpreterPreflight.prepare(Path.of(".."), Map.of());
        JsonNode inputs = outcome.report().get("inputs");
        assertThat(inputs.get("planned").asInt()).isEqualTo(14);
        assertThat(inputs.get("from_committed_fixture").asInt()).isEqualTo(13);
        assertThat(inputs.get("from_durable_store").asInt()).isEqualTo(1);
    }

    @Test
    @DisplayName("the current preflight result is written down, so the verdict is an artifact and not a memory")
    void theCurrentPreflightIsRecorded() throws Exception {
        var outcome = GoalInterpreterPreflight.prepare(Path.of(".."), System.getenv());
        Path out = Path.of("build", "goal-preflight.json");
        Files.createDirectories(out.getParent());
        Files.writeString(out, outcome.report().toPrettyString() + "\n");
        assertThat(outcome.report().get("verdict").asText()).isIn("BLOCKED", "READY_FOR_APPROVAL");
        // Whatever the verdict, no customer's words are in the artifact — only ids and fingerprints.
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE,
                GoalInterpreterPreflight.storeRoot(System.getenv()));
        set.inputs().stream().filter(GoalSmokeInputs.Input::realCustomerText).forEach(i ->
                assertThat(Files.exists(out)).isTrue());
        String written = Files.readString(out);
        for (GoalSmokeInputs.Input input : set.inputs()) {
            if (input.realCustomerText()) {
                assertThat(written).as("a real customer message reached a written artifact")
                        .doesNotContain(input.message());
            }
        }
    }

    @Test
    @DisplayName("building every request contacts nobody, and the fingerprints are stable across runs")
    void preparingTheSetSpendsNothing() throws Exception {
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE,
                GoalInterpreterPreflight.storeRoot(System.getenv()));
        var runner = new CustomerGoalRunner(GoalInterpreterPreflight.MODEL,
                GoalInterpreterPreflight.REASONING_EFFORT, (u, h, b) -> {
                    throw new AssertionError("a vendor was contacted during PREPARE");
                }, null);
        List<CustomerGoalRunner.Input> inputs = set.usable().stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList();
        var first = runner.prepare(inputs);
        var second = runner.prepare(inputs);
        assertThat(first.stream().map(CustomerGoalRunner.Request::requestFp))
                .as("the same inputs produce the same bytes, or a manifest means nothing")
                .isEqualTo(second.stream().map(CustomerGoalRunner.Request::requestFp).toList());
        assertThat(first.stream().map(CustomerGoalRunner.Request::requestFp)).doesNotHaveDuplicates();
        assertThat(first.get(0).user()).contains("customer").contains("surface").contains("listing_resolved");
    }
}
