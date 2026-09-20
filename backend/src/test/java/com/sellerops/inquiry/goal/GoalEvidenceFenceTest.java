package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The goal-provenance fence</b> (Inquiry v3.5, {@code customer-goal-interpreter/v2}).
 *
 * <p>The measured defect this exists for: on the fixture message <i>"묶음 상품인 줄 알고 샀는데 한 개만 왔어요"</i>
 * the real 14-call run {@code v35-goal-smoke-07530e82-b3b0a9c5} returned the expected
 * {@link RequestedOutcome#INFORMATION} goal <i>and</i> an {@link RequestedOutcome#ACTION} goal, "부족한 수량을 처리해
 * 주세요", that no clause of that message asks for. Both arrived on {@link RequestBasis#DIRECTLY_IMPLIED} with no
 * evidence of any kind, and nothing in the contract could refuse them — a {@link GoalRelation} must quote the clause
 * that states it, and a goal had no equivalent field at all.
 *
 * <p>The tests below are in two halves, and <b>both halves are the point</b>: the fence must refuse that answer, and
 * it must leave everything the corpus actually contains alone. A fence measured only on what it catches is a fence
 * nobody checked for what it breaks.
 */
class GoalEvidenceFenceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** The exact message the fixture commits for G15, and the one the recorded run was given. */
    private static final String G15 = "묶음 상품인 줄 알고 샀는데 한 개만 왔어요";

    private static CustomerGoal goal(String id, RequestedOutcome outcome, RequestBasis basis, String evidence) {
        return new CustomerGoal(id, "요청", outcome, Referent.CURRENT_ORDER, basis, List.of(), evidence);
    }

    // --- the goal quotes ------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a goal with no quote cannot be built — the fence, not a warning")
    void everyGoalQuotes() {
        for (String nothing : new String[] {null, "", "   "}) {
            assertThatThrownBy(() -> goal("g1", RequestedOutcome.ACTION, RequestBasis.STATED, nothing))
                    .as("evidence=%s", nothing)
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("quotes");
        }
        assertThatThrownBy(() -> goal("g1", RequestedOutcome.ACTION, RequestBasis.STATED,
                "가".repeat(CustomerGoal.MAX_REQUEST + 1))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("two goals may not rest on one clause — a clause has one direct reading")
    void oneClauseOneGoal() {
        assertThatThrownBy(() -> new CustomerGoalSet(List.of(
                goal("g1", RequestedOutcome.ACTION, RequestBasis.STATED, "환불해 주세요"),
                goal("g2", RequestedOutcome.ACTION, RequestBasis.STATED, "환불해 주세요")), List.of()))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("same clause");

        // Containment counts: quoting a fragment of the clause another goal already claims is the same reading.
        assertThatThrownBy(() -> new CustomerGoalSet(List.of(
                goal("g1", RequestedOutcome.ACTION, RequestBasis.STATED, "노즐만 따로 배송해 주세요"),
                goal("g2", RequestedOutcome.ACTION, RequestBasis.STATED, "배송해 주세요")), List.of()))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("same clause");

        assertThatCode(() -> new CustomerGoalSet(List.of(
                goal("g1", RequestedOutcome.ACTION, RequestBasis.STATED, "노즐만 따로 배송해 주세요"),
                goal("g2", RequestedOutcome.ACTION, RequestBasis.STATED, "환불처리 해주세요")), List.of()))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("one message, one inference — a second is the reader choosing a remedy")
    void oneInferencePerMessage() {
        assertThatThrownBy(() -> new CustomerGoalSet(List.of(
                goal("g1", RequestedOutcome.INFORMATION, RequestBasis.DIRECTLY_IMPLIED, "한 개만 왔어요"),
                goal("g2", RequestedOutcome.ACTION, RequestBasis.DIRECTLY_IMPLIED, "묶음 상품인 줄 알고 샀는데")),
                List.of())).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("one goal");

        // Several STATED goals remain ordinary: all five multi-goal messages in the frozen gold are entirely STATED.
        assertThatCode(() -> new CustomerGoalSet(List.of(
                goal("g1", RequestedOutcome.DECISION, RequestBasis.STATED, "승인해 주실 수 있나요"),
                goal("g2", RequestedOutcome.ACTION, RequestBasis.STATED, "교환 처리도 부탁드립니다"),
                goal("g3", RequestedOutcome.INFORMATION, RequestBasis.DIRECTLY_IMPLIED, "언제쯤 될까요")), List.of()))
                .doesNotThrowAnyException();
    }

    // --- the quote is really a quote ------------------------------------------------------------------------------

    @Test
    @DisplayName("a quote the customer never wrote is caught — the half the records cannot hold")
    void theQuoteIsCheckedAgainstTheMessage() {
        CustomerGoalSet invented = CustomerGoalSet.of(
                goal("g1", RequestedOutcome.ACTION, RequestBasis.STATED, "부족한 수량을 처리해 주세요"));
        assertThat(invented.unquoted(G15)).containsExactly("g1");

        CustomerGoalSet real = CustomerGoalSet.of(
                goal("g1", RequestedOutcome.INFORMATION, RequestBasis.DIRECTLY_IMPLIED, "한 개만 왔어요"));
        assertThat(real.unquoted(G15)).isEmpty();

        // Whitespace is not a claim about what the customer said; punctuation is.
        assertThat(CustomerGoalSet.of(goal("g1", RequestedOutcome.INFORMATION, RequestBasis.STATED,
                "한 개만   왔어요")).unquoted(G15)).isEmpty();
        assertThat(CustomerGoalSet.of(goal("g1", RequestedOutcome.INFORMATION, RequestBasis.STATED,
                "한 개만 왔어요!")).unquoted(G15)).containsExactly("g1");

        // A message that was never held evidences nothing, so it fails closed rather than vacuously passing.
        assertThat(real.unquoted(null)).containsExactly("g1");
        assertThat(real.unquoted("  ")).containsExactly("g1");
    }

    @Test
    @DisplayName("relabelling the invented goal STATED does not buy past the quote check")
    void theRelabellingDodgeIsClosed() {
        // With only the inference cap, a model wanting a second inferred goal could call it STATED and pass, basis
        // being an assertion nobody could check. It is checkable now: the words have to be there.
        CustomerGoalSet dodge = new CustomerGoalSet(List.of(
                goal("g1", RequestedOutcome.INFORMATION, RequestBasis.DIRECTLY_IMPLIED, "한 개만 왔어요"),
                goal("g2", RequestedOutcome.ACTION, RequestBasis.STATED, "부족한 수량을 처리해 주세요")), List.of());
        assertThat(dodge.unquoted(G15)).containsExactly("g2");
    }

    // --- the recorded failure, and what the fence does NOT claim ---------------------------------------------------

    @Test
    @DisplayName("the recorded G15 answer is refused, and refused by the cap rather than by luck")
    void theRecordedInventedActionIsRefused() {
        // Exactly what v35-goal-smoke-07530e82-b3b0a9c5 returned for G15, quotes added in the model's best case.
        assertThatThrownBy(() -> new CustomerGoalSet(List.of(
                new CustomerGoal("g1", "한 개만 온 이유를 알려 주세요", RequestedOutcome.INFORMATION,
                        Referent.CURRENT_ORDER, RequestBasis.DIRECTLY_IMPLIED, List.of(), "한 개만 왔어요"),
                new CustomerGoal("g2", "부족한 수량을 처리해 주세요", RequestedOutcome.ACTION,
                        Referent.CURRENT_ORDER, RequestBasis.DIRECTLY_IMPLIED, List.of(),
                        "묶음 상품인 줄 알고 샀는데")), List.of()))
                .isInstanceOf(IllegalArgumentException.class);

        // The answer the gold actually wants: one goal, quoting the clause it was inferred from.
        assertThatCode(() -> CustomerGoalSet.of(new CustomerGoal("g1", "한 개만 온 이유를 알려 주세요",
                RequestedOutcome.INFORMATION, Referent.CURRENT_ORDER, RequestBasis.DIRECTLY_IMPLIED, List.of(),
                "한 개만 왔어요"))).doesNotThrowAnyException();
    }

    /**
     * <b>What this fence does not claim.</b> It refuses the failure that was observed and it makes every goal's
     * grounding a checkable claim. It does not make invention impossible: a model that labels the extra goal
     * {@code STATED} and quotes a <i>different real clause</i> of the same message satisfies all three rules.
     *
     * <p>That residual is deliberately left rather than closed, because closing it needs a rule about which clauses
     * can carry a request — a list of Korean request endings, which is the domain tuning this component exists to do
     * without, and which no test could check independently of a model. What has changed is that the claim is now on
     * the wire in the customer's own words: "this ACTION rests on 묶음 상품인 줄 알고 샀는데" is a countable, reviewable
     * assertion, where the recorded failure asserted nothing at all.
     *
     * <p>This is a test so the residual is recorded in the suite rather than only in prose. If a later package closes
     * it, this test is the one that must change, and changing it is the decision.
     */
    @Test
    @DisplayName("KNOWN RESIDUAL: a STATED relabel that quotes another real clause still passes all three rules")
    void theFenceDoesNotCatchEverything() {
        CustomerGoalSet residual = new CustomerGoalSet(List.of(
                new CustomerGoal("g1", "한 개만 온 이유를 알려 주세요", RequestedOutcome.INFORMATION,
                        Referent.CURRENT_ORDER, RequestBasis.DIRECTLY_IMPLIED, List.of(), "한 개만 왔어요"),
                new CustomerGoal("g2", "부족한 수량을 처리해 주세요", RequestedOutcome.ACTION,
                        Referent.CURRENT_ORDER, RequestBasis.STATED, List.of(), "묶음 상품인 줄 알고 샀는데")),
                List.of());
        assertThat(residual.unquoted(G15)).as("both quotes are real spans, so the quote check cannot see this")
                .isEmpty();
    }

    /**
     * <b>The over-blocking half.</b> Every committed fixture row must build under v2 and every quote must be a real
     * span of that row's own message — so the fence is known to cost the corpus nothing, rather than assumed to.
     *
     * <p>The same measurement was run against the frozen real-corpus gold's 72 goals (0 of 72 lost to the cap; each
     * of its 4 inferred goals is the only goal of its message) and against the 14 recorded run rows (exactly one
     * refused). Those two live outside this repository, so they are recorded in {@link CustomerGoalSet}'s contract
     * rather than asserted here — this is the part a test can hold.
     */
    @Test
    @DisplayName("all 23 committed fixture rows build under v2, and every quote is really in its own message")
    void theFixtureCostsNothing() throws Exception {
        Path fixture = Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic", "goal-scenarios.jsonl");
        int goals = 0;
        int rows = 0;
        for (String line : Files.readAllLines(fixture)) {
            if (line.isBlank()) {
                continue;
            }
            rows++;
            JsonNode row = JSON.readTree(line);
            List<CustomerGoal> built = new ArrayList<>();
            for (JsonNode g : row.get("goals")) {
                List<String> constraints = new ArrayList<>();
                g.get("explicit_constraints").forEach(c -> constraints.add(c.asText()));
                built.add(new CustomerGoal(g.get("id").asText(), g.get("explicit_request").asText(),
                        RequestedOutcome.valueOf(g.get("requested_outcome").asText()),
                        Referent.valueOf(g.get("subject").asText()),
                        RequestBasis.valueOf(g.get("basis").asText()), constraints, g.get("evidence").asText()));
                goals++;
            }
            // The message exactly as GoalSmokeInputs derives it: written for a multi-goal row, and the single goal's
            // own request otherwise. Nothing invented here either.
            String message = row.hasNonNull("customer_message") ? row.get("customer_message").asText()
                    : (built.size() == 1 ? built.get(0).explicitRequest() : null);
            assertThat(message).as("%s has several goals and no committed message", row.get("id").asText())
                    .isNotNull();
            CustomerGoalSet set = new CustomerGoalSet(built, List.of());
            assertThat(set.unquoted(message)).as("%s quotes words its message does not contain",
                    row.get("id").asText()).isEmpty();
        }
        assertThat(rows).isEqualTo(23);
        assertThat(goals).isEqualTo(25);
    }
}
