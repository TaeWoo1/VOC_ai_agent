package com.sellerops.inquiry.goal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/**
 * <b>The Customer Goal Interpreter harness</b> (Inquiry v3.5) — it builds the request a production door would send,
 * and in exactly one of its three modes actually sends it.
 *
 * <p>It lives in the test tree, like the planner's harness and for the same reason: the interpreter has <b>no
 * production caller</b>, and putting a sender in {@code main} would quietly make that untrue. Nothing here is
 * reachable from the application.
 *
 * <h2>Three modes, and only one spends</h2>
 *
 * <ul>
 *   <li>{@link Mode#PREPARE} — build every request, fingerprint it, and stop. <b>Zero vendor calls</b>, enforced by
 *       the transport never being touched: the field is not read on this path, and a test asserts a transport that
 *       throws on contact is never contacted.</li>
 *   <li>{@link Mode#RUN} — the real call, under a hard cap checked <i>before</i> each send, against an approval
 *       bound by {@link GoalRunGuard}. Raw is written before anything derived from it exists.</li>
 *   <li>{@link Mode#REPLAY} — recorded raw answers read again by the current parser. Each rebuilt request must hash
 *       to the recorded {@code request_fp}, so a re-score is provably about the same bytes. Zero vendor calls.</li>
 * </ul>
 *
 * <h2>Nothing is repaired</h2>
 *
 * <p>The failure taxonomy is the planner's, because the vendor's ways of not answering have not changed: an HTTP
 * failure, a refusal, a truncated answer, an empty message, an unparseable envelope, and — reached later — content
 * that parses but is not a legal goal set. In every one of them {@code raw} is null and {@code said} keeps whatever
 * arrived. <b>A truncated JSON object is never mended</b>: the goal set of a half-written answer is not a smaller
 * version of the right one, it is an unknown one, and the four unrecoverable truncations of the 2026-09-20 shadow
 * are why the prefix is kept at all.
 */
public final class CustomerGoalRunner {

    public static final String VERSION = "customer-goal-runner/v1";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final String model;
    private final String reasoningEffort;
    private final AgentLlmTransport transport;
    private final URI endpoint;

    public CustomerGoalRunner(String model, String reasoningEffort, AgentLlmTransport transport, URI endpoint) {
        this.model = model;
        this.reasoningEffort = reasoningEffort;
        this.transport = transport;
        this.endpoint = endpoint;
    }

    public enum Mode { PREPARE, RUN, REPLAY }

    /** One input: an id and the customer's message. Nothing else reaches the vendor. */
    public record Input(String id, String message) {
    }

    public record Result(List<String> rows, int calls) {
    }

    /** The request this input would produce, with the fingerprints that identify it. */
    public record Request(String id, String user, String body, String requestFp) {
    }

    /**
     * Build every request without sending any. The same code path {@link Mode#RUN} sends from, so a manifest's
     * fingerprints are of the bytes that would actually go out rather than of a reconstruction.
     */
    public List<Request> prepare(List<Input> inputs) {
        List<Request> out = new ArrayList<>();
        for (Input in : inputs) {
            String user = CustomerGoalPrompt.user(in.message(), null);
            String body = body(user);
            out.add(new Request(in.id(), user, body, sha(body)));
        }
        return List.copyOf(out);
    }

    /**
     * @param maxCalls  the approved hard cap, checked before every send
     * @param recorded  {@code id → row}, for {@link Mode#REPLAY}
     * @param sink      called with each row's bytes the moment they exist and BEFORE anything is derived from them
     */
    public Result run(String runId, Mode mode, List<Input> inputs, int maxCalls, Map<String, JsonNode> recorded,
                      java.util.function.Consumer<String> sink) {
        List<String> out = new ArrayList<>();
        int calls = 0;
        for (Request request : prepare(inputs)) {
            String content;
            String said;
            String failure;
            String finish = null;
            long elapsed = 0;
            switch (mode) {
                case PREPARE -> {
                    // Nothing is sent and nothing is claimed about an answer. The row records the request only.
                    content = null;
                    said = null;
                    failure = "NOT_SENT";
                }
                case REPLAY -> {
                    JsonNode row = recorded.get(request.id());
                    if (row == null) {
                        throw new IllegalStateException("no recorded row for " + request.id());
                    }
                    if (!request.requestFp().equals(row.path("request_fp").asText())) {
                        throw new IllegalStateException("request_fp mismatch for " + request.id()
                                + " — the replay is not about the same request");
                    }
                    content = row.path("raw").isNull() ? null : row.path("raw").asText();
                    said = row.path("said").isNull() ? null : row.path("said").asText();
                    failure = row.path("failure").isNull() ? null : row.path("failure").asText();
                    finish = row.path("finish").isNull() ? null : row.path("finish").asText();
                }
                default -> {
                    GoalRunGuard.checkCap(calls, maxCalls);
                    AgentLlmTransport.Response response = transport.post(endpoint,
                            Map.of("Content-Type", "application/json"), request.body());
                    calls++;
                    Envelope envelope = Envelope.of(response);
                    content = envelope.content();
                    said = envelope.said();
                    failure = envelope.failure();
                    finish = envelope.finish();
                    elapsed = response == null ? 0 : response.elapsedMs();
                }
            }
            String row = row(runId, mode, request, content, said, failure, finish, elapsed);
            // Raw first. Everything after this line is derived, and a derivation that throws must not be able to
            // take the observation with it — a recorded answer cannot be produced a second time.
            sink.accept(row);
            out.add(row);
        }
        return new Result(List.copyOf(out), calls);
    }

    private String body(String user) {
        ObjectNode root = JSON.createObjectNode();
        root.put("model", model);
        ArrayNode messages = root.putArray("messages");
        messages.addObject().put("role", "system").put("content", CustomerGoalPrompt.system());
        messages.addObject().put("role", "user").put("content", user);
        root.put("max_completion_tokens", CustomerGoalPrompt.MAX_OUTPUT_TOKENS);
        root.set("response_format", CustomerGoalPrompt.responseFormat());
        if (reasoningEffort != null && !reasoningEffort.isBlank()) {
            root.put("reasoning_effort", reasoningEffort);
        }
        return root.toString();
    }

    /**
     * One row. {@code raw} is the answer that may be read as a goal set and {@code said} is what the vendor sent —
     * the same string on success, and different exactly where a call failed with something in hand.
     */
    private String row(String runId, Mode mode, Request request, String content, String said, String failure,
                       String finish, long elapsedMs) {
        ObjectNode row = JSON.createObjectNode();
        row.put("run_id", runId).put("mode", mode.name()).put("id", request.id());
        row.put("runner", VERSION).put("prompt_version", CustomerGoalPrompt.VERSION)
                .put("model", model).put("reasoning_effort", reasoningEffort);
        row.put("system_fp", CustomerGoalPrompt.sha256(CustomerGoalPrompt.system()))
                .put("schema_fp", CustomerGoalPrompt.sha256(CustomerGoalPrompt.schema().toString()))
                .put("input_fp", sha(request.user())).put("request_fp", request.requestFp());
        row.put("elapsed_ms", elapsedMs);
        row.put("finish", finish);
        row.put("raw", content);
        row.put("said", said);

        if (content == null) {
            row.put("failure", failure);
            row.putNull("goals");
            row.putArray("relations");
            row.put("valid", false);
            return row.toString();
        }
        Parsed parsed = parse(content);
        row.put("failure", parsed.failure());
        if (parsed.failure() != null) {
            row.putNull("goals");
            row.putArray("relations");
            row.put("valid", false);
        } else {
            row.set("goals", parsed.goals());
            row.set("relations", parsed.relations());
            row.put("valid", true);
        }
        return row.toString();
    }

    /**
     * Content that arrived and may be read. Two ways it can still be refused: it is not JSON of the declared shape
     * ({@code GOAL_UNPARSEABLE}), or it is JSON that the contract will not construct ({@code GOAL_CONTRACT}) —
     * an outcome outside the four, a request longer than a request, a relation with no clause behind it. The second
     * is checked by <b>building the real records</b> rather than by a second copy of their rules.
     */
    private static Parsed parse(String content) {
        JsonNode root;
        try {
            root = JSON.readTree(content);
        } catch (Exception e) {
            return new Parsed(null, null, "GOAL_UNPARSEABLE");
        }
        if (root == null || !root.isObject() || !root.has("goals")) {
            return new Parsed(null, null, "GOAL_UNPARSEABLE");
        }
        try {
            List<CustomerGoal> goals = new ArrayList<>();
            for (JsonNode g : root.get("goals")) {
                List<String> constraints = new ArrayList<>();
                g.path("explicit_constraints").forEach(c -> constraints.add(c.asText()));
                goals.add(new CustomerGoal(g.path("id").asText(), g.path("explicit_request").asText(),
                        RequestedOutcome.valueOf(g.path("requested_outcome").asText()),
                        Referent.valueOf(g.path("subject").asText()),
                        RequestBasis.valueOf(g.path("basis").asText()), constraints));
            }
            List<GoalRelation> relations = new ArrayList<>();
            if (root.has("relations")) {
                for (JsonNode r : root.get("relations")) {
                    relations.add(new GoalRelation(GoalRelation.Kind.valueOf(r.path("kind").asText()),
                            r.path("primary_goal_id").asText(), r.path("fallback_goal_id").asText(),
                            r.path("stated_condition").asText()));
                }
            }
            new CustomerGoalSet(goals, relations); // the set's own rules: ids, one fallback each, no cycles
            return new Parsed(root.get("goals"), root.has("relations") ? root.get("relations")
                    : JSON.createArrayNode(), null);
        } catch (IllegalArgumentException | NullPointerException e) {
            return new Parsed(null, null, "GOAL_CONTRACT");
        }
    }

    private record Parsed(JsonNode goals, JsonNode relations, String failure) {
    }

    /**
     * What came back, before any reading of the content. A refusal, a cut-off answer, an HTTP failure and an empty
     * message are different facts and are recorded as such — each is still no opinion at all.
     */
    record Envelope(String content, String said, String finish, String failure) {
        static Envelope of(AgentLlmTransport.Response response) {
            if (response == null) {
                return new Envelope(null, null, null, "TRANSPORT");
            }
            if (!response.ok()) {
                return new Envelope(null, blankToNull(response.body()), null,
                        response.status() == 0 ? "TRANSPORT" : "HTTP_" + response.status());
            }
            try {
                JsonNode choice = JSON.readTree(response.body()).path("choices").path(0);
                String finish = choice.path("finish_reason").asText(null);
                String said = choice.path("message").path("content").asText("");
                JsonNode refusal = choice.path("message").path("refusal");
                if (refusal.isTextual() && !refusal.asText().isBlank()) {
                    return new Envelope(null, refusal.asText(), finish, "REFUSAL");
                }
                if ("length".equals(finish)) {
                    return new Envelope(null, blankToNull(said), finish, "TRUNCATED");
                }
                return said.isBlank() ? new Envelope(null, null, finish, "EMPTY")
                        : new Envelope(said, said, finish, null);
            } catch (Exception e) {
                return new Envelope(null, blankToNull(response.body()), null, "UNPARSEABLE");
            }
        }

        private static String blankToNull(String s) {
            return s == null || s.isBlank() ? null : s;
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
