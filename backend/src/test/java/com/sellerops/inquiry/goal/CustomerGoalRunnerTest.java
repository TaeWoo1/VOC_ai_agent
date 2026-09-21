package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * <b>What the runner records, and what it refuses to invent</b> (Inquiry v3.5).
 *
 * <p>The approval matrix lives in {@code GoalRunLauncherTest}; this is about the other half — that every way a
 * vendor can fail to answer is a distinct recorded fact, that nothing is ever repaired, and that the two modes
 * which are supposed to send nothing contact nobody. "Contacts nobody" is asserted by handing the runner a
 * transport that throws on contact and then using it.
 */
class CustomerGoalRunnerTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final URI ENDPOINT = URI.create("https://vendor.invalid/v1/chat/completions");

    private static final List<CustomerGoalRunner.Input> TWO = GoalRunFixtures.INPUTS.stream()
            .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList();

    /** A transport that refuses to be used. The only honest way to assert "zero vendor calls". */
    private static AgentLlmTransport refusing() {
        return (uri, headers, body) -> {
            throw new AssertionError("a vendor was contacted");
        };
    }

    private static String vendor(String finish, String content, String refusal) {
        var root = JSON.createObjectNode();
        var choice = root.putArray("choices").addObject();
        choice.put("finish_reason", finish);
        var message = choice.putObject("message");
        if (content == null) {
            message.putNull("content");
        } else {
            message.put("content", content);
        }
        if (refusal != null) {
            message.put("refusal", refusal);
        }
        return root.toString();
    }

    private static CustomerGoalRunner runner(AgentLlmTransport transport) {
        return new CustomerGoalRunner("gpt-5-2025-08-07", "minimal", transport, ENDPOINT);
    }

    private static List<JsonNode> rowsOf(List<String> rows) {
        List<JsonNode> out = new ArrayList<>();
        for (String row : rows) {
            try {
                out.add(JSON.readTree(row));
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        return out;
    }

    /** One approved send, answered by the given transport. The manifest comes from a real preflight. */
    private static List<JsonNode> answered(Path dir, AgentLlmTransport transport) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        var sink = new GoalRunFixtures.Recording();
        var runner = GoalRunFixtures.runner(transport, GoalRunFixtures.credential());
        var result = runner.send(approved.manifest(), approved.world(dir.resolve("rows.jsonl")),
                approved.inputs(), sink);
        assertThat(result.calls()).isEqualTo(2);
        return rowsOf(result.rows());
    }

    @Test
    @DisplayName("PREPARE builds every request and contacts nobody")
    void prepareSpendsNothing() {
        var result = runner(refusing()).dryRun("r1", TWO, new GoalRunFixtures.Recording());
        assertThat(result.calls()).isZero();
        assertThat(rowsOf(result.rows())).hasSize(2).allSatisfy(row -> {
            assertThat(row.get("failure").asText()).isEqualTo("NOT_SENT");
            assertThat(row.get("raw").isNull()).isTrue();
            assertThat(row.get("valid").asBoolean()).isFalse();
            assertThat(row.get("request_fp").asText()).hasSize(64);
        });
        // The request bytes are real: the same body RUN would post, not a reconstruction of it.
        var requests = runner(refusing()).prepare(TWO);
        assertThat(requests).hasSize(2);
        assertThat(requests.get(0).body()).contains("\"model\":\"gpt-5-2025-08-07\"")
                .contains("\"reasoning_effort\":\"minimal\"").contains("json_schema")
                .contains("제품 소재가 뭔가요?");
        assertThat(requests.get(0).requestFp()).isEqualTo(CustomerGoalRunner.sha(requests.get(0).body()));
    }

    @Test
    @DisplayName("every way of not answering is a different recorded fact, and none of them is an opinion")
    void theFailureTaxonomyIsPreservedAndFailsClosed(@TempDir Path dir) throws Exception {
        Map<String, AgentLlmTransport> cases = new java.util.LinkedHashMap<>();
        cases.put("HTTP_429", (u, h, b) -> new AgentLlmTransport.Response(429, "{\"error\":\"rate\"}", 1L));
        cases.put("TRANSPORT", (u, h, b) -> new AgentLlmTransport.Response(0, "connect reset", 1L));
        cases.put("REFUSAL", (u, h, b) -> new AgentLlmTransport.Response(200,
                vendor("stop", null, "I can't help with that."), 1L));
        cases.put("TRUNCATED", (u, h, b) -> new AgentLlmTransport.Response(200,
                vendor("length", GoalRunFixtures.GOOD_ANSWER.substring(0, 40), null), 1L));
        cases.put("EMPTY", (u, h, b) -> new AgentLlmTransport.Response(200, vendor("stop", "", null), 1L));
        cases.put("UNPARSEABLE", (u, h, b) -> new AgentLlmTransport.Response(200, "<html>nope</html>", 1L));
        cases.put("GOAL_UNPARSEABLE", (u, h, b) -> new AgentLlmTransport.Response(200,
                vendor("stop", "not json at all", null), 1L));
        cases.put("GOAL_CONTRACT", (u, h, b) -> new AgentLlmTransport.Response(200, vendor("stop",
                "{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"r\",\"requested_outcome\":\"REFUND\","
                        + "\"subject\":\"CURRENT_LISTING\",\"basis\":\"STATED\",\"explicit_constraints\":[]}],"
                        + "\"relations\":[]}", null), 1L));

        int n = 0;
        for (var entry : cases.entrySet()) {
            JsonNode row = answered(dir.resolve("case" + n++), entry.getValue()).get(0);
            assertThat(row.get("failure").asText()).as("%s", entry.getKey()).isEqualTo(entry.getKey());
            assertThat(row.get("valid").asBoolean()).as("%s must not produce a verdict", entry.getKey()).isFalse();
            assertThat(row.get("goals").isNull()).as("%s produced goals", entry.getKey()).isTrue();
        }
    }

    @Test
    @DisplayName("what the vendor said is kept even when it may not be read, and is never repaired")
    void saidIsEvidenceAndNeverAnInput(@TempDir Path dir) throws Exception {
        String cut = GoalRunFixtures.GOOD_ANSWER.substring(0, 40);
        JsonNode row = answered(dir.resolve("cut"),
                (u, h, b) -> new AgentLlmTransport.Response(200, vendor("length", cut, null), 1L)).get(0);
        assertThat(row.get("failure").asText()).isEqualTo("TRUNCATED");
        assertThat(row.get("said").asText()).as("the only evidence of why it ran long").isEqualTo(cut);
        assertThat(row.get("said").asText()).doesNotEndWith("}"); // kept as it arrived: not closed, not completed
        assertThat(row.get("raw").isNull()).as("a half-written answer never reaches the parser").isTrue();

        JsonNode refused = answered(dir.resolve("refusal"),
                (u, h, b) -> new AgentLlmTransport.Response(200, vendor("stop", null, "no"), 1L)).get(0);
        assertThat(refused.get("said").asText()).isEqualTo("no");
    }

    /**
     * <b>The defect the v2 holdout arm found, fixed and pinned</b> (§26.7).
     *
     * <p>{@code parse} builds {@link CustomerGoal} objects, which express the contract this commit ships. Pointed
     * at a comparison arm it called a valid v2 answer {@code GOAL_CONTRACT} for using a word v2 REQUIRED — 39 of 75
     * rows on the first paired run, with the vendor answering all 75 at {@code finish=stop}. The number read as a
     * model defect and was a harness defect, which is the direction that matters: a comparison arm scoring badly
     * for a reason that is nothing to do with the model would have argued against the merge on false evidence.
     */
    @Test
    @DisplayName("a comparison arm is recorded, not judged — this commit's records do not referee a retired one")
    void aForeignArmIsNotJudgedByThisCommitsRecords() throws Exception {
        // A v2 answer: valid under v2, and using a token v3 has no record for.
        String v2Answer = "{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"제품 소재가 뭔가요?\","
                + "\"requested_outcome\":\"INFORMATION\",\"subject\":\"CURRENT_LISTING\",\"basis\":\"STATED\","
                + "\"explicit_constraints\":[],\"evidence\":\"제품 소재가 뭔가요?\"}],\"relations\":[]}";

        CustomerGoalRunner v2 = new CustomerGoalRunner(GoalInterpreterPreflight.MODEL,
                GoalInterpreterPreflight.REASONING_EFFORT, refusing(), null,
                java.util.Map.of(), CustomerGoalPrompt.Arm.V2);
        JsonNode row = replayedRow(v2, v2Answer);

        assertThat(row.get("prompt_version").asText()).isEqualTo("customer-goal-interpreter/v2");
        assertThat(row.get("failure").isNull()).as("a valid v2 answer is NOT a contract failure").isTrue();
        assertThat(row.get("parsed_by_this_commit").asBoolean()).isFalse();
        assertThat(row.get("not_parsed_reason").asText()).contains("FOREIGN_ARM");
        // The observation survives in full — that is what the JS mirror scores from.
        assertThat(row.get("raw").asText()).isEqualTo(v2Answer);
        assertThat(row.get("goals").isNull()).as("this commit has no records for v2; it does not invent any")
                .isTrue();

        // The current arm is unchanged: it is still read into the real records, and still refuses a bad answer.
        CustomerGoalRunner v3 = GoalRunFixtures.runner(refusing(), java.util.Map.of());
        JsonNode good = replayedRow(v3, GoalRunFixtures.GOOD_ANSWER);
        assertThat(good.get("parsed_by_this_commit").asBoolean()).isTrue();
        assertThat(good.get("failure").isNull()).isTrue();
        assertThat(good.get("goals")).hasSize(1);

        CustomerGoalRunner v3bad = GoalRunFixtures.runner(refusing(), java.util.Map.of());
        JsonNode refused = replayedRow(v3bad, v2Answer);
        assertThat(refused.get("failure").asText())
                .as("under the CURRENT contract, a retired token is still a contract failure")
                .isEqualTo("GOAL_CONTRACT");
        assertThat(refused.get("parsed_by_this_commit").asBoolean()).isTrue();
    }

    /**
     * Replay one recorded answer through the given runner and return the row it writes.
     *
     * <p>REPLAY rather than a send, and that is not a convenience: this is about how an answer is READ, and a send
     * would first have to satisfy the guard — which correctly refuses a v2 runner holding a manifest built for the
     * current arm, on {@code prompt_version}, both prompt fingerprints and {@code request_fp_set}. Proving that is
     * {@code GoalSmokePreflightTest}'s job; proving the reading is this one's.
     */
    private JsonNode replayedRow(CustomerGoalRunner runner, String answer) throws Exception {
        var input = new CustomerGoalRunner.Input("G01", "제품 소재가 뭔가요?");
        var request = runner.prepare(java.util.List.of(input)).get(0);
        var recorded = JSON.createObjectNode();
        recorded.put("request_fp", request.requestFp()).put("raw", answer).put("said", answer)
                .putNull("failure").put("finish", "stop").put("elapsed_ms", 1);
        var result = runner.replay("r", java.util.List.of(input),
                java.util.Map.of("G01", recorded), new GoalRunFixtures.Recording());
        return rowsOf(result.rows()).get(0);
    }

    @Test
    @DisplayName("a good answer is read into the real records, so the wire cannot be laxer than the contract")
    void aGoodAnswerIsReadByTheContractItself(@TempDir Path dir) throws Exception {
        JsonNode row = answered(dir.resolve("good"),
                (u, h, b) -> new AgentLlmTransport.Response(200,
                        vendor("stop", GoalRunFixtures.GOOD_ANSWER, null), 12L)).get(0);
        assertThat(row.get("failure").isNull()).isTrue();
        assertThat(row.get("valid").asBoolean()).isTrue();
        assertThat(row.get("goals")).hasSize(1);
        assertThat(row.get("relations")).isEmpty();

        // A relation with no quoted condition is refused by GoalRelation's own constructor, reached from here.
        // Both goals quote distinct real spans of G01's message, so the ONLY thing wrong here is the empty clause.
        String noClause = "{\"goals\":[{\"id\":\"a\",\"explicit_request\":\"r\",\"requested_outcome\":\"ACTION\","
                + "\"subject\":\"CURRENT_ORDER\",\"basis\":\"STATED\",\"explicit_constraints\":[],"
                + "\"evidence\":\"제품 소재가\"},"
                + "{\"id\":\"b\",\"explicit_request\":\"r2\",\"requested_outcome\":\"ACTION\","
                + "\"subject\":\"CURRENT_ORDER\",\"basis\":\"STATED\",\"explicit_constraints\":[],"
                + "\"evidence\":\"뭔가요?\"}],"
                + "\"relations\":[{\"kind\":\"FALLBACK\",\"primary_goal_id\":\"a\",\"fallback_goal_id\":\"b\","
                + "\"stated_condition\":\"\"}]}";
        JsonNode invented = answered(dir.resolve("noclause"),
                (u, h, b) -> new AgentLlmTransport.Response(200, vendor("stop", noClause, null), 1L)).get(0);
        assertThat(invented.get("failure").asText()).isEqualTo("GOAL_CONTRACT");
    }

    @Test
    @DisplayName("REPLAY re-scores recorded answers, contacts nobody, and refuses a fingerprint that moved")
    void replayIsAboutTheSameBytes(@TempDir Path dir) throws Exception {
        JsonNode recordedRow = answered(dir.resolve("recorded"),
                (u, h, b) -> new AgentLlmTransport.Response(200,
                        vendor("stop", GoalRunFixtures.GOOD_ANSWER, null), 12L)).get(0);
        Map<String, JsonNode> rows = new HashMap<>();
        rows.put("G01", recordedRow);

        var replayed = runner(refusing()).replay("r1", TWO.subList(0, 1), rows, new GoalRunFixtures.Recording());
        assertThat(replayed.calls()).isZero();
        assertThat(rowsOf(replayed.rows()).get(0).get("goals")).hasSize(1);

        var moved = List.of(new CustomerGoalRunner.Input("G01", "다른 질문입니다"));
        assertThatThrownBy(() -> runner(refusing()).replay("r1", moved, rows, new GoalRunFixtures.Recording()))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("request_fp mismatch");
    }

    @Test
    @DisplayName("an auth failure is recorded once per input and does not stop the run — semantics A, pinned")
    void everyRequestIsSentIndependentlyEvenAfterAnAuthFailure(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        java.util.concurrent.atomic.AtomicInteger sends = new java.util.concurrent.atomic.AtomicInteger();
        AgentLlmTransport rejecting = (u, h, b) -> {
            sends.incrementAndGet();
            return new AgentLlmTransport.Response(401, "{\"error\":\"invalid_api_key\"}", 1L);
        };

        var result = GoalRunFixtures.runner(rejecting, GoalRunFixtures.credential())
                .send(approved.manifest(), approved.world(dir.resolve("rows.jsonl")), approved.inputs(),
                        new GoalRunFixtures.Recording());

        // This is the CURRENT and WRITTEN contract, not an accident: ApprovalManifest.NO_RETRY says "one request
        // per input; a failed call is a recorded failure". A bad credential therefore produces one HTTP_401 row
        // per input rather than one row and a stop. Nothing here is billed — a rejected request is not a
        // completion — so the cost of the remaining calls is time, not money.
        //
        // Whether a fatal auth failure SHOULD short-circuit the rest is a change to that written contract and is
        // raised as a product decision rather than made here. This test exists so that the behaviour is pinned
        // either way, and so that changing it is a decision somebody takes rather than a diff nobody notices.
        assertThat(sends.get()).isEqualTo(approved.inputs().size());
        assertThat(result.calls()).isEqualTo(approved.inputs().size());
        assertThat(rowsOf(result.rows())).allSatisfy(row -> {
            assertThat(row.get("failure").asText()).isEqualTo("HTTP_401");
            assertThat(row.get("raw").isNull()).isTrue();
            assertThat(row.get("valid").asBoolean()).isFalse();
        });
    }

    @Test
    @DisplayName("a recorded run is never overwritten")
    void outputIsCreateOrFail(@TempDir Path dir) throws Exception {
        Path out = dir.resolve("rows.jsonl");
        CustomerGoalRunner.write(out, List.of("{\"a\":1}"));
        assertThat(Files.readAllLines(out)).hasSize(1);
        assertThatThrownBy(() -> CustomerGoalRunner.write(out, List.of("{\"a\":2}")))
                .isInstanceOf(java.nio.file.FileAlreadyExistsException.class);
        assertThat(Files.readString(out)).contains("\"a\":1");
    }
}
