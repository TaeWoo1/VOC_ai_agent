package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What an unusable answer leaves behind</b> (Inquiry v3 WP-3.1).
 *
 * <p>Five ways a planner call can end, and the row each one writes. The property under test is not that the plan is
 * refused — that was already true and is asserted here only so it cannot be traded away — but that the five are
 * <b>distinguishable afterwards</b>: a failure word that names the kind, and the vendor's own bytes kept beside it.
 *
 * <p>The 67-call shadow of 2026-09-20 truncated four times and the run artifact could say nothing about why, because
 * {@code Envelope.of} dropped the partial content one line after reading it. A row that records only that something
 * went wrong turns a diagnosis into a re-run, and a re-run of a planner is a new sample, not the same one.
 *
 * <p><b>Fail-closed is the invariant, not the exception.</b> In every failing case below the row's {@code plan} is
 * null, {@code valid} is false and {@code raw} — the field the parser reads — is null. Only {@code said} is populated,
 * and nothing in this system reads it.
 */
class ResolutionPlannerEnvelopeTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String PLAN = "{\"needs\":[{\"id\":\"N1\",\"ask\":\"이 주문의 현재 배송 상태\","
            + "\"steps\":[{\"capability\":\"ENTITY.ORDER\",\"role\":\"CLOSES\",\"fields\":[\"ORDER_FULFILLMENT\"]}],"
            + "\"customer_inputs\":[]}]}";

    /** The vendor's envelope, built the way the vendor builds it. */
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
        var usage = root.putObject("usage");
        usage.put("prompt_tokens", 1497).put("completion_tokens", 1600);
        return root.toString();
    }

    private static JsonNode row(AgentLlmTransport transport) throws Exception {
        var runner = new ResolutionPlannerRunner(ResolutionPlannerHarnessIntegrityTest.props(), transport,
                UUID.randomUUID());
        var scenarios = ResolutionPlannerHarnessIntegrityTest.valid().subList(0, 1);
        var result = runner.run("envelope", ResolutionPlannerRunner.Mode.MODEL,
                ResolutionPlannerHarnessIntegrityTest.inputs(scenarios), 1, 1, Map.of(), Map.of());
        return JSON.readTree(result.rows().get(0));
    }

    private static JsonNode rowFor(int status, String body) throws Exception {
        return row((uri, headers, json) -> new AgentLlmTransport.Response(status, body, 12L));
    }

    /** Every failing row, read the same way: no plan, not valid, nothing for the parser to read. */
    private static void refusedButRecorded(JsonNode row, String failure) {
        assertThat(row.get("failure").asText()).isEqualTo(failure);
        assertThat(row.get("plan").isNull()).as("a failed call never produces a plan").isTrue();
        assertThat(row.get("valid").asBoolean()).isFalse();
        assertThat(row.get("raw").isNull()).as("the parser's field stays empty").isTrue();
        assertThat(row.get("violations")).isEmpty();
    }

    @Test
    @DisplayName("stop: the answer is the plan, and `said` is the same bytes")
    void stop() throws Exception {
        JsonNode row = rowFor(200, vendor("stop", PLAN, null));
        assertThat(row.get("failure").isNull()).isTrue();
        assertThat(row.get("finish").asText()).isEqualTo("stop");
        assertThat(row.get("raw").asText()).isEqualTo(PLAN);
        assertThat(row.get("said").asText()).as("one successful answer, not two").isEqualTo(PLAN);
        assertThat(row.get("valid").asBoolean()).isTrue();
        assertThat(row.get("plan").get("needs")).hasSize(1);
    }

    @Test
    @DisplayName("truncated mid-JSON: the plan is refused and the prefix is kept, unrepaired")
    void truncatedWithPartialJson() throws Exception {
        String cut = PLAN.substring(0, 74);
        JsonNode row = rowFor(200, vendor("length", cut, null));
        refusedButRecorded(row, "TRUNCATED");
        assertThat(row.get("finish").asText()).isEqualTo("length");
        assertThat(row.get("said").asText()).as("the only evidence of why it ran long").isEqualTo(cut);
        // kept exactly as it arrived: not closed, not completed, not parsed
        assertThat(row.get("said").asText()).doesNotEndWith("}");
    }

    @Test
    @DisplayName("truncated before any JSON: the row says TRUNCATED and holds nothing, which is itself the finding")
    void truncatedBeforeJson() throws Exception {
        JsonNode row = rowFor(200, vendor("length", "", null));
        refusedButRecorded(row, "TRUNCATED");
        assertThat(row.get("finish").asText()).isEqualTo("length");
        assertThat(row.get("said").isNull()).as("blank is recorded as nothing, never as an empty answer").isTrue();
        // TRUNCATED with no content at all is a different observation from TRUNCATED with a prefix, and the pair
        // (finish=length, said=null) is what tells them apart — the shadow's four rows could be either.
    }

    @Test
    @DisplayName("refusal: the refusal sentence is kept, and it is not a plan")
    void refusal() throws Exception {
        JsonNode row = rowFor(200, vendor("stop", null, "I can't help with that."));
        refusedButRecorded(row, "REFUSAL");
        assertThat(row.get("said").asText()).isEqualTo("I can't help with that.");
    }

    @Test
    @DisplayName("malformed: known-shaped bytes that are not a plan reach the parser and fail there, still recorded")
    void malformed() throws Exception {
        JsonNode row = rowFor(200, vendor("stop", "{\"needs\":[{\"id\":\"N1\"}]}", null));
        assertThat(row.get("failure").asText()).as("the envelope was fine; the content was not")
                .isEqualTo("UNPARSEABLE");
        assertThat(row.get("plan").isNull()).isTrue();
        assertThat(row.get("valid").asBoolean()).isFalse();
        // a parse failure is the one case where `raw` survives, and has since WP-2 — `said` matches it
        assertThat(row.get("raw").asText()).isEqualTo("{\"needs\":[{\"id\":\"N1\"}]}");
        assertThat(row.get("said").asText()).isEqualTo(row.get("raw").asText());
    }

    @Test
    @DisplayName("an HTTP failure keeps the vendor's error body, which is all there is to keep")
    void httpFailure() throws Exception {
        JsonNode row = rowFor(429, "{\"error\":{\"code\":\"rate_limit_exceeded\"}}");
        refusedButRecorded(row, "HTTP_429");
        assertThat(row.get("said").asText()).contains("rate_limit_exceeded");
        assertThat(row.get("finish").isNull()).isTrue();
    }

    @Test
    @DisplayName("the five endings are five different rows — no two are confusable after the fact")
    void distinguishable() throws Exception {
        List<JsonNode> rows = List.of(
                rowFor(200, vendor("stop", PLAN, null)),
                rowFor(200, vendor("length", PLAN.substring(0, 74), null)),
                rowFor(200, vendor("length", "", null)),
                rowFor(200, vendor("stop", null, "I can't help with that.")),
                rowFor(200, vendor("stop", "{\"needs\":[{\"id\":\"N1\"}]}", null)));
        List<String> signatures = rows.stream()
                .map(r -> (r.get("failure").isNull() ? "OK" : r.get("failure").asText())
                        + "/" + (r.get("finish").isNull() ? "-" : r.get("finish").asText())
                        + "/" + (r.get("said").isNull() ? "none" : "kept"))
                .toList();
        assertThat(signatures).containsExactly("OK/stop/kept", "TRUNCATED/length/kept", "TRUNCATED/length/none",
                "REFUSAL/stop/kept", "UNPARSEABLE/stop/kept");
        assertThat(signatures).doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("the row carries the snapshot its fingerprint is of, so availability is answerable offline")
    void registryIsWrittenDown() throws Exception {
        JsonNode row = rowFor(200, vendor("stop", PLAN, null));
        JsonNode registry = row.get("registry");
        assertThat(registry.get("capabilities").get("ENTITY.ORDER").asText()).isEqualTo("AVAILABLE");
        assertThat(registry.get("fields").get("ORDER_TRACKING").asText())
                .as("no source in this repository reads a carrier number, on any channel").isEqualTo("NOT_SUPPORTED");
        assertThat(registry.get("order_bound").asBoolean()).isTrue();
        JsonNode step = row.get("availability").get(0);
        assertThat(step.get("gap").isNull()).isTrue();
        assertThat(step.get("unavailable_fields")).isEmpty();
    }

    @Test
    @DisplayName("an over-read entity step records WHICH field made it a gap, not only that it is one")
    void unavailableFieldsAreNamed() throws Exception {
        String overRead = "{\"needs\":[{\"id\":\"N1\",\"ask\":\"이 주문의 현재 배송 상태\",\"steps\":[{\"capability\""
                + ":\"ENTITY.ORDER\",\"role\":\"CLOSES\",\"fields\":[\"ORDER_FULFILLMENT\",\"ORDER_TRACKING\"]}],"
                + "\"customer_inputs\":[]}]}";
        JsonNode step = rowFor(200, vendor("stop", overRead, null)).get("availability").get(0);
        assertThat(step.get("gap").asText()).isEqualTo("NOT_SUPPORTED");
        assertThat(step.get("unavailable_fields")).singleElement()
                .satisfies(f -> assertThat(f.asText()).isEqualTo("ORDER_TRACKING"));
        // ORDER_FULFILLMENT is available on this snapshot; the step is a gap anyway, and that is the all-or-nothing
        // rule in ResolutionPlanValidator.gapOf — measured in docs/inquiry_architecture_v3_wp31.md §2, not changed here.
    }
}
