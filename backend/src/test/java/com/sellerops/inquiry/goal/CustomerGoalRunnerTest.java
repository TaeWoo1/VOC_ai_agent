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
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * <b>The harness cannot spend what it was not approved to spend, and cannot lose what it was told</b>
 * (Inquiry v3.5).
 *
 * <p>Two properties carry everything here. <b>Nothing is sent that a mode did not authorize</b> — asserted by giving
 * the runner a transport that throws on contact and then using it. And <b>raw is written before anything derived
 * from it exists</b> — asserted by making the derivation throw and checking the observation survived, because a
 * vendor answer cannot be produced a second time.
 */
class CustomerGoalRunnerTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final URI ENDPOINT = URI.create("https://vendor.invalid/v1/chat/completions");

    private static final List<CustomerGoalRunner.Input> TWO = List.of(
            new CustomerGoalRunner.Input("G01", "제품 소재가 뭔가요?"),
            new CustomerGoalRunner.Input("G04", "주문 취소해 주세요"));

    /** A transport that refuses to be used. The only honest way to assert "zero vendor calls". */
    private static AgentLlmTransport refusing() {
        return (uri, headers, body) -> {
            throw new AssertionError("a vendor was contacted");
        };
    }

    private static AgentLlmTransport answering(String content) {
        return (uri, headers, body) -> new AgentLlmTransport.Response(200, vendor("stop", content, null), 12L);
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

    private static final String GOOD = "{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"제품 소재가 뭔가요?\","
            + "\"requested_outcome\":\"INFORMATION\",\"subject\":\"CURRENT_LISTING\",\"basis\":\"STATED\","
            + "\"explicit_constraints\":[]}],\"relations\":[]}";

    private static CustomerGoalRunner runner(AgentLlmTransport transport) {
        return new CustomerGoalRunner("gpt-5-2025-08-07", "minimal", transport, ENDPOINT);
    }

    private static List<JsonNode> rowsOf(CustomerGoalRunner.Result result) {
        List<JsonNode> out = new ArrayList<>();
        for (String row : result.rows()) {
            try {
                out.add(JSON.readTree(row));
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        return out;
    }

    @Test
    @DisplayName("PREPARE builds every request and contacts nobody")
    void prepareSpendsNothing() {
        var result = runner(refusing()).run("r1", CustomerGoalRunner.Mode.PREPARE, TWO, 0, Map.of(), s -> { });
        assertThat(result.calls()).isZero();
        assertThat(rowsOf(result)).hasSize(2).allSatisfy(row -> {
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
    @DisplayName("the hard cap is checked before a send, so it cannot be exceeded by one")
    void theCapHolds() {
        AtomicInteger sent = new AtomicInteger();
        AgentLlmTransport counting = (uri, headers, body) -> {
            sent.incrementAndGet();
            return new AgentLlmTransport.Response(200, vendor("stop", GOOD, null), 1L);
        };
        assertThatThrownBy(() -> runner(counting).run("r1", CustomerGoalRunner.Mode.RUN, TWO, 1, Map.of(), s -> { }))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("GOAL_MAX_CALLS");
        assertThat(sent.get()).as("the second call was refused before it left").isEqualTo(1);

        // A cap of zero sends nothing at all, rather than "one, then stop".
        assertThatThrownBy(() -> runner(counting).run("r2", CustomerGoalRunner.Mode.RUN, TWO, 0, Map.of(), s -> { }))
                .isInstanceOf(IllegalStateException.class);
        assertThat(sent.get()).isEqualTo(1);
    }

    @Test
    @DisplayName("raw reaches the sink before anything derived from it exists")
    void rawIsPersistedFirst() {
        List<String> persisted = new ArrayList<>();
        assertThatThrownBy(() -> runner(answering(GOOD)).run("r1", CustomerGoalRunner.Mode.RUN, TWO, 2, Map.of(),
                row -> {
                    persisted.add(row);
                    throw new IllegalStateException("scoring blew up");
                })).isInstanceOf(IllegalStateException.class).hasMessageContaining("scoring blew up");
        assertThat(persisted).as("the observation survived the failure of everything after it").hasSize(1);
        assertThat(persisted.get(0)).contains("\"raw\"");
    }

    @Test
    @DisplayName("every way of not answering is a different recorded fact, and none of them is an opinion")
    void theFailureTaxonomyIsPreservedAndFailsClosed() {
        Map<String, AgentLlmTransport> cases = new java.util.LinkedHashMap<>();
        cases.put("HTTP_429", (u, h, b) -> new AgentLlmTransport.Response(429, "{\"error\":\"rate\"}", 1L));
        cases.put("TRANSPORT", (u, h, b) -> new AgentLlmTransport.Response(0, "connect reset", 1L));
        cases.put("REFUSAL", (u, h, b) -> new AgentLlmTransport.Response(200,
                vendor("stop", null, "I can't help with that."), 1L));
        cases.put("TRUNCATED", (u, h, b) -> new AgentLlmTransport.Response(200,
                vendor("length", GOOD.substring(0, 40), null), 1L));
        cases.put("EMPTY", (u, h, b) -> new AgentLlmTransport.Response(200, vendor("stop", "", null), 1L));
        cases.put("UNPARSEABLE", (u, h, b) -> new AgentLlmTransport.Response(200, "<html>nope</html>", 1L));
        cases.put("GOAL_UNPARSEABLE", (u, h, b) -> new AgentLlmTransport.Response(200,
                vendor("stop", "not json at all", null), 1L));
        cases.put("GOAL_CONTRACT", (u, h, b) -> new AgentLlmTransport.Response(200, vendor("stop",
                "{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"r\",\"requested_outcome\":\"REFUND\","
                        + "\"subject\":\"CURRENT_LISTING\",\"basis\":\"STATED\",\"explicit_constraints\":[]}],"
                        + "\"relations\":[]}", null), 1L));

        for (var entry : cases.entrySet()) {
            var result = runner(entry.getValue()).run("r1", CustomerGoalRunner.Mode.RUN,
                    TWO.subList(0, 1), 1, Map.of(), s -> { });
            JsonNode row = rowsOf(result).get(0);
            assertThat(row.get("failure").asText()).as("%s", entry.getKey()).isEqualTo(entry.getKey());
            assertThat(row.get("valid").asBoolean()).as("%s must not produce a verdict", entry.getKey()).isFalse();
            assertThat(row.get("goals").isNull()).as("%s produced goals", entry.getKey()).isTrue();
        }
    }

    @Test
    @DisplayName("what the vendor said is kept even when it may not be read, and is never repaired")
    void saidIsEvidenceAndNeverAnInput() {
        String cut = GOOD.substring(0, 40);
        var result = runner((u, h, b) -> new AgentLlmTransport.Response(200, vendor("length", cut, null), 1L))
                .run("r1", CustomerGoalRunner.Mode.RUN, TWO.subList(0, 1), 1, Map.of(), s -> { });
        JsonNode row = rowsOf(result).get(0);
        assertThat(row.get("failure").asText()).isEqualTo("TRUNCATED");
        assertThat(row.get("said").asText()).as("the only evidence of why it ran long").isEqualTo(cut);
        assertThat(row.get("said").asText()).doesNotEndWith("}"); // kept as it arrived: not closed, not completed
        assertThat(row.get("raw").isNull()).as("a half-written answer never reaches the parser").isTrue();

        // A refusal keeps its sentence, and an unparseable envelope keeps the vendor's own body.
        var refused = runner((u, h, b) -> new AgentLlmTransport.Response(200, vendor("stop", null, "no"), 1L))
                .run("r2", CustomerGoalRunner.Mode.RUN, TWO.subList(0, 1), 1, Map.of(), s -> { });
        assertThat(rowsOf(refused).get(0).get("said").asText()).isEqualTo("no");
    }

    @Test
    @DisplayName("a good answer is read into the real records, so the wire cannot be laxer than the contract")
    void aGoodAnswerIsReadByTheContractItself() {
        var result = runner(answering(GOOD)).run("r1", CustomerGoalRunner.Mode.RUN, TWO.subList(0, 1), 1,
                Map.of(), s -> { });
        JsonNode row = rowsOf(result).get(0);
        assertThat(row.get("failure").isNull()).isTrue();
        assertThat(row.get("valid").asBoolean()).isTrue();
        assertThat(row.get("goals")).hasSize(1);
        assertThat(row.get("relations")).isEmpty();

        // A relation with no quoted condition is refused by GoalRelation's own constructor, reached from here.
        String noClause = "{\"goals\":[{\"id\":\"a\",\"explicit_request\":\"r\",\"requested_outcome\":\"ACTION\","
                + "\"subject\":\"CURRENT_ORDER\",\"basis\":\"STATED\",\"explicit_constraints\":[]},"
                + "{\"id\":\"b\",\"explicit_request\":\"r2\",\"requested_outcome\":\"ACTION\","
                + "\"subject\":\"CURRENT_ORDER\",\"basis\":\"STATED\",\"explicit_constraints\":[]}],"
                + "\"relations\":[{\"kind\":\"FALLBACK\",\"primary_goal_id\":\"a\",\"fallback_goal_id\":\"b\","
                + "\"stated_condition\":\"\"}]}";
        var invented = runner(answering(noClause)).run("r2", CustomerGoalRunner.Mode.RUN, TWO.subList(0, 1), 1,
                Map.of(), s -> { });
        assertThat(rowsOf(invented).get(0).get("failure").asText()).isEqualTo("GOAL_CONTRACT");
    }

    @Test
    @DisplayName("REPLAY re-scores recorded answers, contacts nobody, and refuses a fingerprint that moved")
    void replayIsAboutTheSameBytes() throws Exception {
        var recorded = runner(answering(GOOD)).run("r1", CustomerGoalRunner.Mode.RUN, TWO.subList(0, 1), 1,
                Map.of(), s -> { });
        Map<String, JsonNode> rows = new HashMap<>();
        JsonNode row = rowsOf(recorded).get(0);
        rows.put("G01", row);

        var replayed = runner(refusing()).run("r1", CustomerGoalRunner.Mode.REPLAY, TWO.subList(0, 1), 0, rows,
                s -> { });
        assertThat(replayed.calls()).isZero();
        assertThat(rowsOf(replayed).get(0).get("goals")).hasSize(1);

        // Change the request the replay would rebuild, and it refuses rather than re-scoring the wrong thing.
        var moved = List.of(new CustomerGoalRunner.Input("G01", "다른 질문입니다"));
        assertThatThrownBy(() -> runner(refusing()).run("r1", CustomerGoalRunner.Mode.REPLAY, moved, 0, rows,
                s -> { })).isInstanceOf(IllegalStateException.class).hasMessageContaining("request_fp mismatch");
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
