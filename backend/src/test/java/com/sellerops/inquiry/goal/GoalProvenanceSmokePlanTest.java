package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The six-case v2 provenance smoke, and the fourteen-case smoke it must not disturb</b> (Inquiry v3.5 §25).
 *
 * <p>The plan exists to measure the {@code evidence} fence <b>in both directions at once</b>: {@code G15} is the
 * recorded invented {@code ACTION}, and {@code R:4181864b} is a real message whose gold goal is a legitimate
 * {@code DIRECTLY_IMPLIED} {@code ACTION}. A run that reached only one of them would report half a result and read
 * like a whole one — so the pairing is asserted here rather than left to whoever edits the list next.
 */
class GoalProvenanceSmokePlanTest {

    private static final Path FIXTURE =
            Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic", "goal-scenarios.jsonl");

    private static Path storeRoot() {
        Path root = GoalInterpreterPreflight.storeRoot(Map.of());
        return Files.exists(root.resolve(GoalSmokeInputs.CAPTURE)) ? root : null;
    }

    @Test
    @DisplayName("the plan names the six cases the fence has to be measured on, and says why each is there")
    void thePlanIsTheSix() {
        GoalSmokeInputs.Plan plan = GoalSmokeInputs.PROVENANCE_SMOKE;
        assertThat(plan.planned()).isEqualTo(6);
        assertThat(plan.fixtureIds()).containsExactly("G15", "G23", "G07", "G01");
        assertThat(plan.storeIds()).containsExactly("R:4181864b", "R:0c582144");

        // Both directions, named as one shape so a later edit cannot drop either half quietly.
        assertThat(plan.intended()).containsEntry("no_invented_remedy", "G15");
        assertThat(plan.intended()).containsEntry("legitimate_implied_action_survives", "R:4181864b");
        assertThat(plan.intended()).containsEntry("fence_measured_in_both_directions", "G15+R:4181864b");

        // A targeted plan owes the outcomes it actually relies on, and says so rather than inheriting "all four".
        assertThat(plan.requiredOutcomes()).containsExactly("INFORMATION", "DECISION", "ACTION");
        assertThat(plan.requiredOutcomes()).doesNotContain("STATE_READ");
        assertThat(GoalSmokeInputs.PLANS).containsKey(plan.name());
    }

    @Test
    @DisplayName("the fourteen-case contract smoke is untouched by the arrival of a second plan")
    void theOriginalPlanDidNotMove() {
        GoalSmokeInputs.Plan plan = GoalSmokeInputs.CONTRACT_SMOKE;
        assertThat(plan.planned()).isEqualTo(14);
        assertThat(plan.fixtureIds()).isEqualTo(GoalSmokeInputs.CHOSEN).hasSize(13);
        assertThat(plan.storeIds()).containsExactly(GoalSmokeInputs.NO_GOAL_CASE);
        assertThat(plan.requiredOutcomes()).containsExactly("INFORMATION", "STATE_READ", "DECISION", "ACTION");
        assertThat(plan.intended()).isEqualTo(GoalSmokeInputs.INTENDED);
    }

    @Test
    @DisplayName("all six assemble, two carry a real customer's words, and no shape is short")
    void theSixAssemble() throws Exception {
        Path store = storeRoot();
        if (store == null) {
            return; // the durable store is not restored here; the two real messages live only in it
        }
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE, store, GoalSmokeInputs.PROVENANCE_SMOKE);
        assertThat(set.missing()).isEmpty();
        assertThat(set.usable()).hasSize(6);
        assertThat(set.usable().stream().map(GoalSmokeInputs.Input::id))
                .containsExactly("G15", "G23", "G07", "G01", "R:4181864b", "R:0c582144");
        assertThat(set.complete()).isTrue();
        assertThat(set.coverage().values()).noneMatch(v -> v.startsWith("MISSING"));

        // Two real messages, so the manifest must declare it. This is the field an operator reads to know that a
        // run touches a customer's own words rather than fixtures somebody wrote to be easy.
        assertThat(set.realCustomerText()).isTrue();
        assertThat(set.usable().stream().filter(GoalSmokeInputs.Input::realCustomerText).count()).isEqualTo(2);

        // Nothing here was written by this harness: every message is either a committed byte or a store read.
        for (GoalSmokeInputs.Input in : set.usable()) {
            assertThat(in.message()).as("%s", in.id()).isNotBlank();
        }
    }

    @Test
    @DisplayName("a plan that cannot reach one of its shapes is short, and says which — it does not round down")
    void amissingShapeIsReported() throws Exception {
        // The same plan with the real implied-ACTION case removed: the half of the fence that catches over-blocking
        // is then unreachable, and the set must say so rather than report five happy cases.
        GoalSmokeInputs.Plan halved = new GoalSmokeInputs.Plan("half", "one direction only",
                GoalSmokeInputs.PROVENANCE_SMOKE.fixtureIds(), List.of(GoalSmokeInputs.NO_GOAL_CASE),
                GoalSmokeInputs.PROVENANCE_SMOKE.requiredOutcomes(),
                GoalSmokeInputs.PROVENANCE_SMOKE.intended());
        Path store = storeRoot();
        if (store == null) {
            return;
        }
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE, store, halved);
        assertThat(set.complete()).isFalse();
        assertThat(set.coverage().get("legitimate_implied_action_survives")).startsWith("MISSING");
        assertThat(set.coverage().get("fence_measured_in_both_directions")).startsWith("MISSING");
    }

    @Test
    @DisplayName("the launcher rebuilds exactly what a manifest names, in its order, from fixture and store alike")
    void forIdsIsWhatTheManifestSays() throws Exception {
        Path store = storeRoot();
        if (store == null) {
            return;
        }
        List<String> ids = List.of("R:0c582144", "G01", "R:4181864b", "G23");
        GoalSmokeInputs.Set set = GoalSmokeInputs.forIds(FIXTURE, store, ids);
        assertThat(set.missing()).isEmpty();
        assertThat(set.usable().stream().map(GoalSmokeInputs.Input::id)).containsExactlyElementsOf(ids);

        // An id nobody can rebuild is named, not skipped: a shorter run is a different run.
        GoalSmokeInputs.Set gap = GoalSmokeInputs.forIds(FIXTURE, store, List.of("G01", "R:nope"));
        assertThat(gap.complete()).isFalse();
        assertThat(gap.missing()).singleElement().asString().contains("R:nope");
    }

    /**
     * <b>The DEV plan is the gold's whole case set, not a hand-picked subset.</b>
     *
     * <p>The 67 ids are committed and the 67 messages are not, so nothing in git can show that the list still matches
     * the corpus. This is what shows it: a case added to or removed from the frozen gold makes the committed list
     * wrong, loudly, instead of silently turning a baseline into a selection.
     */
    @Test
    @DisplayName("the 67-case DEV plan is every case the frozen gold carries — and every one resolves to a message")
    void theDevPlanIsTheWholeCorpus() throws Exception {
        GoalSmokeInputs.Plan plan = GoalSmokeInputs.DEV_DIAGNOSTIC;
        assertThat(plan.planned()).isEqualTo(67);
        assertThat(plan.fixtureIds()).isEmpty();
        assertThat(plan.storeIds()).hasSize(67).doesNotHaveDuplicates()
                .isEqualTo(GoalSmokeInputs.DEV_CASES);
        // A baseline owes no fixture shapes: none of these is a fixture row, and their labels live outside git.
        assertThat(plan.intended()).isEmpty();
        assertThat(plan.requiredOutcomes()).isEmpty();
        // The case this corpus is most about is in it.
        assertThat(plan.storeIds()).contains(GoalSmokeInputs.NO_GOAL_CASE, "R:4181864b");

        Path store = storeRoot();
        if (store == null) {
            return;   // the gold and the messages both live in the durable store
        }
        Path goldFile = Path.of(System.getProperty("user.home"), ".cache", "sellerops-eval",
                "inquiry-customer-goal", "v3", "goals.jsonl");
        if (!Files.exists(goldFile)) {
            return;
        }
        com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();
        java.util.SortedSet<String> inGold = new java.util.TreeSet<>();
        for (String line : Files.readAllLines(goldFile)) {
            if (!line.isBlank()) {
                inGold.add(json.readTree(line).get("q").asText());
            }
        }
        assertThat(plan.storeIds()).as("the committed DEV list and the frozen gold have diverged")
                .containsExactlyElementsOf(inGold);

        // And every one of them rebuilds into an input, so a 67-call manifest is a 67-call manifest.
        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(FIXTURE, store, plan);
        assertThat(set.missing()).isEmpty();
        assertThat(set.usable()).hasSize(67);
        assertThat(set.complete()).isTrue();
        assertThat(set.realCustomerText()).isTrue();
        assertThat(set.usable().stream().filter(GoalSmokeInputs.Input::realCustomerText).count()).isEqualTo(67);
    }
}
