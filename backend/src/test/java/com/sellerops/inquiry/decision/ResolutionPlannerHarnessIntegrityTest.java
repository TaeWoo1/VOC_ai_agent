package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.inquiry.resolution.ResolutionPlannerPrompt;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The planner harness measured on itself, before it is ever pointed at a model: the oracle run must reproduce the gold
 * exactly, a replay must refuse inputs that moved, the cap must hold, and a recorded observation must be impossible to
 * overwrite.
 */
class ResolutionPlannerHarnessIntegrityTest {

    static final ObjectMapper JSON = new ObjectMapper();
    static final Path SCENARIOS = Path.of("..", "contracts", "inquiry-planner", "v2", "synthetic",
            "planner-scenarios.jsonl");
    static final AgentLlmTransport REFUSES = (uri, headers, json) -> {
        throw new IllegalStateException("this mode must not reach a transport");
    };

    static InquiryDecisionProperties props() {
        return new InquiryDecisionProperties(true, "*", "gpt-5-2025-08-07", "offline-no-key", 800, 2400, "minimal",
                InquiryDecisionPrompt.JUDGE_V2, "", InquiryDecisionProperties.FORMAT_JSON_SCHEMA);
    }

    /** The valid scenarios as planner inputs, and their plans as the oracle's answers. */
    static List<JsonNode> valid() throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String l : Files.readAllLines(SCENARIOS)) {
            if (l.isBlank()) {
                continue;
            }
            JsonNode expect = JSON.readTree(l).get("expect");
            if (expect.path("expressible").asBoolean(true) && expect.path("valid").asBoolean(false)) {
                out.add(JSON.readTree(l));
            }
        }
        return out;
    }

    static List<ResolutionPlannerRunner.Input> inputs(List<JsonNode> scenarios) {
        List<ResolutionPlannerRunner.Input> out = new ArrayList<>();
        for (JsonNode s : scenarios) {
            var row = JSON.createObjectNode();
            row.put("q", s.get("id").asText()).put("question", s.get("question").asText());
            row.set("registry", s.get("registry"));
            out.add(ResolutionPlannerRunner.Input.of(row));
        }
        return out;
    }

    static Map<String, String> oracle(List<JsonNode> scenarios) {
        Map<String, String> out = new LinkedHashMap<>();
        scenarios.forEach(s -> out.put(s.get("id").asText(), s.get("plan").toString()));
        return out;
    }

    @Test
    @DisplayName("the oracle run reproduces the gold: every row valid, no violation, availability as the fixture says")
    void oracleRun() throws Exception {
        List<JsonNode> scenarios = valid();
        ResolutionPlannerRunner runner = new ResolutionPlannerRunner(props(), REFUSES, UUID.randomUUID());
        ResolutionPlannerRunner.Result r = runner.run("test-run", ResolutionPlannerRunner.Mode.ORACLE,
                inputs(scenarios), 1, 0, oracle(scenarios), Map.of());
        assertThat(r.calls()).isZero();
        assertThat(r.rows()).hasSize(scenarios.size());
        for (int i = 0; i < r.rows().size(); i++) {
            JsonNode row = JSON.readTree(r.rows().get(i));
            JsonNode scenario = scenarios.get(i);
            String id = scenario.get("id").asText();
            assertThat(row.get("valid").asBoolean()).as(id).isTrue();
            assertThat(row.get("violations")).as(id).isEmpty();
            assertThat(row.get("failure").isNull()).as(id).isTrue();
            List<String> gaps = new ArrayList<>();
            row.get("availability").forEach(a -> gaps.add(a.get("gap").isNull() ? null : a.get("gap").asText()));
            List<String> want = new ArrayList<>();
            scenario.get("expect").get("availability").forEach(x -> want.add(x.isNull() ? null : x.asText()));
            assertThat(gaps).as(id + " availability").isEqualTo(want);
            assertThat(row.get("prompt_version").asText()).isEqualTo(ResolutionPlannerPrompt.VERSION);
            for (String fp : new String[]{"system_fp", "schema_fp", "input_fp", "request_fp", "registry_fp"}) {
                assertThat(row.get(fp).asText()).as(id + " " + fp).hasSize(64);
            }
        }
    }

    @Test
    @DisplayName("fingerprints separate what differs and join what does not")
    void fingerprints() throws Exception {
        List<JsonNode> scenarios = valid();
        ResolutionPlannerRunner runner = new ResolutionPlannerRunner(props(), REFUSES, UUID.randomUUID());
        List<String> rows = runner.run("r", ResolutionPlannerRunner.Mode.ORACLE, inputs(scenarios), 2, 0,
                oracle(scenarios), Map.of()).rows();
        Map<String, String> byQ = new LinkedHashMap<>();
        Map<String, String> registryByQ = new LinkedHashMap<>();
        for (String s : rows) {
            JsonNode row = JSON.readTree(s);
            String q = row.get("q").asText();
            if (row.get("rep").asInt() == 1) {
                byQ.put(q, row.get("input_fp").asText());
                registryByQ.put(q, row.get("registry_fp").asText());
            } else {
                assertThat(row.get("input_fp").asText()).as("a repetition asks the same thing").isEqualTo(byQ.get(q));
            }
        }
        assertThat(byQ.get("P01")).isNotEqualTo(byQ.get("P02"));
        // P01 (Cafe24, exact allowed) and P05 (NAVER public Q&A, unbound) are different situations for the registry
        assertThat(registryByQ.get("P01")).isNotEqualTo(registryByQ.get("P05"));
        // the system and schema are one contract across every row
        assertThat(rows.stream().map(s -> read(s, "system_fp")).distinct().toList()).hasSize(1);
    }

    @Test
    @DisplayName("a replay refuses a recorded row whose request is not the one being rebuilt")
    void replayRefusesDrift() throws Exception {
        List<JsonNode> scenarios = valid().subList(0, 1);
        ResolutionPlannerRunner runner = new ResolutionPlannerRunner(props(), REFUSES, UUID.randomUUID());
        List<String> rows = runner.run("r", ResolutionPlannerRunner.Mode.ORACLE, inputs(scenarios), 1, 0,
                oracle(scenarios), Map.of()).rows();
        Map<String, JsonNode> recorded = new HashMap<>();
        JsonNode row = JSON.readTree(rows.get(0));
        recorded.put(row.get("q").asText() + "|1", row);
        assertThat(runner.run("r2", ResolutionPlannerRunner.Mode.REPLAY, inputs(scenarios), 1, 0, Map.of(), recorded)
                .rows()).hasSize(1);
        var drifted = ((com.fasterxml.jackson.databind.node.ObjectNode) row.deepCopy())
                .put("input_fp", "0".repeat(64));
        recorded.put(row.get("q").asText() + "|1", drifted);
        assertThatThrownBy(() -> runner.run("r3", ResolutionPlannerRunner.Mode.REPLAY, inputs(scenarios), 1, 0,
                Map.of(), recorded)).hasMessageContaining("input_fp mismatch");
    }

    @Test
    @DisplayName("the cap holds: a model run with no allowance sends nothing")
    void capHolds() throws Exception {
        List<JsonNode> scenarios = valid().subList(0, 1);
        ResolutionPlannerRunner runner = new ResolutionPlannerRunner(props(), REFUSES, UUID.randomUUID());
        assertThatThrownBy(() -> runner.run("r", ResolutionPlannerRunner.Mode.MODEL, inputs(scenarios), 1, 0,
                Map.of(), Map.of())).hasMessageContaining("PLAN_MAX_CALLS reached");
    }

    @Test
    @DisplayName("a recorded observation is never overwritten")
    void noOverwrite(@TempDir Path dir) throws Exception {
        Path out = dir.resolve("run.jsonl");
        ResolutionPlannerRunner.write(out, List.of("{\"q\":\"P01\"}"));
        assertThatThrownBy(() -> ResolutionPlannerRunner.write(out, List.of("{\"q\":\"P01\"}")))
                .isInstanceOf(java.nio.file.FileAlreadyExistsException.class);
        assertThat(Files.readAllLines(out)).containsExactly("{\"q\":\"P01\"}");
    }

    static String read(String row, String field) {
        try {
            return JSON.readTree(row).get(field).asText();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
