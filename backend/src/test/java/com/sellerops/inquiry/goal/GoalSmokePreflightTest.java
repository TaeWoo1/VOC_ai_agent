package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The smoke's inputs, checked against committed source rather than against the document that describes them</b>
 * (Inquiry v3.5).
 *
 * <p>§22.11 names fourteen inputs. This asserts what the repository actually has, and the answer is not fourteen —
 * which is the finding, not a failure. Two of the named rows carry several goals and therefore <b>no customer
 * message</b>, and the fourteenth is a real customer message that lives in the eval store and not in the fixture.
 *
 * <p>The tests below pin that gap open. If somebody later closes it by writing input text, these numbers move and
 * the change has to be deliberate; if somebody closes it by quietly concatenating goals, the fallback row's missing
 * clause is named here as the reason that does not work.
 */
class GoalSmokePreflightTest {

    private static final Path FIXTURE = Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic",
            "goal-scenarios.jsonl");

    @Test
    @DisplayName("the fixture is a fixture of expected OUTPUT — for multi-goal rows it carries no input")
    void theInputSetIsIncompleteAndSaysSo() throws Exception {
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE);
        assertThat(GoalSmokeInputs.CHOSEN).hasSize(13);
        assertThat(set.usable()).as("single-goal rows carry the customer's own words and need nothing derived")
                .hasSize(11);
        assertThat(set.inputs().stream().filter(i -> !i.derivable()).map(GoalSmokeInputs.Input::id))
                .containsExactly("G07", "G23");
        assertThat(set.complete()).isFalse();

        // The fallback row is the one where a naive join would be actively wrong, and the reason is recorded.
        assertThat(set.inputs().stream().filter(i -> i.id().equals("G23")).findFirst().orElseThrow().why())
                .contains("stated condition").contains("drops it");
    }

    @Test
    @DisplayName("the NO_GOAL case is missing, and it is missing for a reason that is not a typo")
    void theNoGoalCaseIsRealCustomerText() throws Exception {
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE);
        assertThat(set.missing()).anySatisfy(m -> assertThat(m).contains(GoalSmokeInputs.NO_GOAL_CASE)
                .contains("real customer text"));
        assertThat(set.coverage().get("no_goal")).startsWith("MISSING");
        // Everything the smoke is for, and which of it survives. Written down so the trade is visible.
        assertThat(set.coverage().get("outcome:INFORMATION")).isEqualTo("covered");
        assertThat(set.coverage().get("outcome:STATE_READ")).isEqualTo("covered");
        assertThat(set.coverage().get("outcome:DECISION")).isEqualTo("covered");
        assertThat(set.coverage().get("outcome:ACTION")).isEqualTo("covered");
        assertThat(set.coverage().get("explicit_fallback")).startsWith("MISSING");
        assertThat(set.coverage().get("multi_goal")).startsWith("MISSING");
        assertThat(set.coverage().get("no_invented_prerequisite_goal")).startsWith("covered");
        assertThat(set.coverage().get("unavailable_capability_keeps_semantics")).startsWith("covered");
    }

    @Test
    @DisplayName("the preflight refuses rather than producing a manifest with a hole in it")
    void aBlockedPreflightProducesNoManifest() throws Exception {
        var outcome = GoalInterpreterPreflight.prepare(Path.of(".."),
                Map.of("SELLEROPS_INQUIRY_GOAL_API_KEY", "x", "SELLEROPS_INQUIRY_GOAL_ENDPOINT", "y"));
        assertThat(outcome.ready()).isFalse();
        assertThat(outcome.manifest()).isNull();
        assertThat(outcome.report().get("verdict").asText()).isEqualTo("BLOCKED");
        assertThat(outcome.blockers()).anySatisfy(b -> assertThat(b).startsWith("INPUT_NOT_DERIVABLE"));
        assertThat(outcome.blockers()).anySatisfy(b -> assertThat(b).startsWith("INPUT_MISSING"));
        assertThat(outcome.blockers()).anySatisfy(b -> assertThat(b).startsWith("COVERAGE"));
    }

    @Test
    @DisplayName("building every usable request contacts nobody, and the fingerprints are stable across runs")
    void preparingTheUsableSetSpendsNothing() throws Exception {
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE);
        var runner = new CustomerGoalRunner(GoalInterpreterPreflight.MODEL,
                GoalInterpreterPreflight.REASONING_EFFORT, (u, h, b) -> {
                    throw new AssertionError("a vendor was contacted during PREPARE");
                }, null);
        List<CustomerGoalRunner.Input> inputs = set.usable().stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList();
        var first = runner.prepare(inputs);
        var second = runner.prepare(inputs);
        assertThat(first).hasSize(11);
        assertThat(first.stream().map(CustomerGoalRunner.Request::requestFp))
                .as("the same inputs produce the same bytes, or a manifest means nothing")
                .isEqualTo(second.stream().map(CustomerGoalRunner.Request::requestFp).toList());
        assertThat(first.stream().map(CustomerGoalRunner.Request::requestFp)).doesNotHaveDuplicates();
        // The customer's message is in the payload and nothing else about them is.
        assertThat(first.get(0).user()).contains("customer").contains("surface").contains("listing_resolved");
    }
}
