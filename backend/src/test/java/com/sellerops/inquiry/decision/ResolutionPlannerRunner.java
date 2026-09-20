package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.resolution.ResolutionPlan;
import com.sellerops.inquiry.resolution.ResolutionPlanParser;
import com.sellerops.inquiry.resolution.ResolutionPlanValidator;
import com.sellerops.inquiry.resolution.ResolutionPlannerPrompt;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * <b>The Resolution Planner harness</b> (Inquiry v3 WP-2) — it builds the request the production door would send, sends it
 * (or does not), and writes one row per call. The same three modes as the judge's calibration:
 *
 * <ul>
 *   <li>{@code oracle} — the gold plan stands in for the model. No call. It proves the pipeline end to end: build →
 *       parse → validate → availability → score.</li>
 *   <li>{@code replay} — recorded raw answers are read again by the CURRENT parser and validator. Each rebuilt request's
 *       user turn must hash to the recorded {@code input_fp}, so a projection is provably about the same inputs.</li>
 *   <li>{@code model} — the real call, under a hard cap. Approval only.</li>
 * </ul>
 *
 * <p><b>Every row carries five fingerprints</b> — system, schema, input (the user turn), request (the whole body) and the
 * registry snapshot. A run whose registry moved is a different observation even when the message is identical.
 *
 * <p><b>Output is never overwritten</b>: {@link #write(Path, List)} creates the file or fails. Raw model answers cannot be
 * regenerated, and the one operational mistake of the v2.2 targeted run was a script that overwrote them.
 */
public final class ResolutionPlannerRunner {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final InquiryDecisionProperties props;
    private final InquiryDecisionGenerator generator;
    private final UUID org;

    public ResolutionPlannerRunner(InquiryDecisionProperties props, AgentLlmTransport transport, UUID org) {
        this.props = props;
        this.generator = new InquiryDecisionGenerator(transport, props);
        this.org = org;
    }

    /** One capture row: the customer's message and the registry facts the request is built from. */
    public record Input(String q, String question, CapabilityRegistry.Inputs registry) {
        public static Input of(JsonNode row) {
            JsonNode r = row.get("registry");
            return new Input(row.get("q").asText(), row.get("question").asText(),
                    new CapabilityRegistry.Inputs(text(r, "channel"), text(r, "subtype"),
                            r.path("orderBound").asBoolean(false),
                            com.sellerops.order.fact.OrderFactLookup.valueOf(r.path("lookup").asText("STORED_ONLY")),
                            r.path("product").asBoolean(false) ? UUID.nameUUIDFromBytes(row.get("q").asText()
                                    .getBytes(StandardCharsets.UTF_8)) : null,
                            DetailCapability.valueOf(r.path("detail").asText("READABLE")),
                            r.path("listingRow").asBoolean(false), r.path("variantCount").asInt(0)));
        }

        private static String text(JsonNode n, String field) {
            JsonNode v = n.path(field);
            return v.isNull() || v.isMissingNode() ? null : v.asText();
        }
    }

    public record Result(List<String> rows, int calls) {
    }

    public enum Mode { ORACLE, REPLAY, MODEL }

    /**
     * @param repeats  runs of each input — run-to-run agreement is a planner metric, so the memo is deliberately not used
     * @param maxCalls hard cap on sends; exceeding it throws (the approved cap)
     * @param oracle   {@code q → raw plan JSON}, for {@link Mode#ORACLE}
     * @param recorded {@code q|rep → row}, for {@link Mode#REPLAY}
     */
    public Result run(String runId, Mode mode, List<Input> inputs, int repeats, int maxCalls,
                      Map<String, String> oracle, Map<String, JsonNode> recorded) {
        List<String> out = new ArrayList<>();
        int calls = 0;
        for (Input in : inputs) {
            CapabilitySnapshot snapshot = CapabilityRegistry.derive(in.registry());
            String user = ResolutionPlannerPrompt.user(in.question(), snapshot);
            String body = generator.resolutionPlanBody(in.question(), snapshot);
            for (int rep = 1; rep <= repeats; rep++) {
                String content;
                String failure;
                InquiryDecisionModel.CallCost cost = InquiryDecisionModel.CallCost.NONE;
                String finish = null;
                switch (mode) {
                    case ORACLE -> {
                        content = oracle.get(in.q());
                        failure = content == null ? "NO_ORACLE_PLAN" : null;
                    }
                    case REPLAY -> {
                        JsonNode row = recorded.get(in.q() + "|" + rep);
                        if (row == null) {
                            throw new IllegalStateException("no recorded row for " + in.q() + " rep " + rep);
                        }
                        if (!sha(user).equals(row.path("input_fp").asText())) {
                            throw new IllegalStateException("input_fp mismatch for " + in.q()
                                    + " — the replay is not about the same request");
                        }
                        content = row.path("raw").isNull() ? null : row.path("raw").asText();
                        failure = row.path("failure").isNull() ? null : row.path("failure").asText();
                        finish = row.path("finish").isNull() ? null : row.path("finish").asText();
                    }
                    default -> {
                        if (calls >= maxCalls) {
                            throw new IllegalStateException("PLAN_MAX_CALLS reached: " + calls);
                        }
                        InquiryDecisionGenerator.ResolutionPlanCall call = generator.resolutionPlan(org, body);
                        calls++;
                        content = call.content();
                        failure = call.failure();
                        finish = call.finish();
                        cost = call.cost();
                    }
                }
                out.add(row(runId, mode, in, snapshot, user, body, rep, content, failure, finish, cost));
            }
        }
        return new Result(out, calls);
    }

    private String row(String runId, Mode mode, Input in, CapabilitySnapshot snapshot, String user, String body,
                       int rep, String content, String failure, String finish,
                       InquiryDecisionModel.CallCost cost) {
        ResolutionPlanParser.Parsed parsed = failure != null ? ResolutionPlanParser.failed(failure)
                : ResolutionPlanParser.parse(content);
        ObjectNode row = JSON.createObjectNode();
        row.put("run_id", runId).put("mode", mode.name()).put("q", in.q()).put("rep", rep);
        row.put("prompt_version", ResolutionPlannerPrompt.VERSION).put("model", props.model())
                .put("reasoning_effort", props.reasoningEffort()).put("format", props.outputFormat());
        row.put("system_fp", sha(ResolutionPlannerPrompt.system()))
                .put("schema_fp", sha(ResolutionPlannerPrompt.schema(snapshot).toString()))
                .put("input_fp", sha(user)).put("request_fp", sha(body))
                .put("registry_fp", snapshot.fingerprint());
        row.put("elapsed_ms", cost.elapsedMs()).put("prompt_tokens", cost.promptTokens())
                .put("completion_tokens", cost.completionTokens());
        row.put("finish", finish);
        row.put("raw", content);
        row.put("failure", parsed.failure());
        if (parsed.plan() != null) {
            ResolutionPlanValidator.Result validation = ResolutionPlanValidator.validate(parsed.plan(), snapshot);
            row.set("plan", plan(parsed.plan()));
            ArrayNode violations = row.putArray("violations");
            validation.violations().forEach(v -> violations.addObject().put("need", v.need())
                    .put("step", v.step() == null ? null : String.valueOf(v.step())).put("code", v.code().name()));
            ArrayNode availability = row.putArray("availability");
            validation.availability().forEach(a -> availability.addObject().put("need", a.need()).put("step", a.step())
                    .put("capability", a.capability().wire())
                    .put("gap", a.gap() == null ? null : a.gap().name()));
            row.put("valid", validation.valid());
        } else {
            row.putNull("plan");
            row.putArray("violations");
            row.putArray("availability");
            row.put("valid", false);
        }
        return row.toString();
    }

    /** The plan as the scorer reads it — the same wire shape the model produced, normalised by the parser. */
    private static JsonNode plan(ResolutionPlan plan) {
        try {
            return JSON.readTree(ResolutionPlanParser.write(plan));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Create or fail. A recorded observation is never overwritten. */
    public static void write(Path out, List<String> rows) throws Exception {
        Files.write(out, rows, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    }

    public static String sha(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
