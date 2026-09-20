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

    /** What this runner does, in the words an approval is bound to. The runner defines its own scope. */
    public static final String SCOPE =
            "offline synthetic smoke — Customer Goal Interpreter, no seller and no channel";

    /** The one header that carries a credential. Its VALUE is never read by anything here except the transport. */
    public static final String AUTHORIZATION = "Authorization";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final String model;
    private final String reasoningEffort;
    private final AgentLlmTransport transport;
    private final URI endpoint;
    private final Map<String, String> headers;

    public CustomerGoalRunner(String model, String reasoningEffort, AgentLlmTransport transport, URI endpoint) {
        this(model, reasoningEffort, transport, endpoint, Map.of());
    }

    /**
     * @param headers what goes out with the request. The credential lives here, comes from the process environment,
     *                and is never read, logged, hashed or persisted by this class — only handed to the transport.
     */
    public CustomerGoalRunner(String model, String reasoningEffort, AgentLlmTransport transport, URI endpoint,
                              Map<String, String> headers) {
        this.model = model;
        this.reasoningEffort = reasoningEffort;
        this.transport = transport;
        this.endpoint = endpoint;
        this.headers = headers == null ? Map.of() : Map.copyOf(headers);
    }

    /** Why a run was refused. Carries reasons and never a value that could be a secret. */
    public static final class Refused extends RuntimeException {
        private final transient List<String> reasons;

        Refused(List<String> reasons) {
            super("RUN refused: " + String.join(", ", reasons));
            this.reasons = List.copyOf(reasons);
        }

        public List<String> reasons() {
            return reasons;
        }
    }

    /**
     * Where a run would happen and what the operator said when granting it.
     *
     * @param grantedApprovalId the id the OPERATOR named, not the one the file claims — comparing a file to itself
     *                          proves nothing, and the point is to catch a launcher aimed at a different manifest
     */
    public record World(Path repoRoot, String grantedApprovalId, String grantedRunId, Path out) {
    }

    /** Two moments, so raw can be durable before anything is derived from it. */
    public interface Sink {
        /** The observation, before any parse. Called first, every time. */
        void raw(String row);

        /** The same row with what could be read from it. Called after. */
        void row(String row);
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

    /** Build every request and record it, sending nothing. No manifest, because nothing leaves. */
    public Result dryRun(String runId, List<Input> inputs, Sink sink) {
        return loop(runId, Mode.PREPARE, inputs, 0, Map.of(), sink, null);
    }

    /** Re-score recorded answers. No manifest, because nothing leaves. */
    public Result replay(String runId, List<Input> inputs, Map<String, JsonNode> recorded, Sink sink) {
        return loop(runId, Mode.REPLAY, inputs, 0, recorded, sink, null);
    }

    /**
     * <b>The only path that contacts a vendor</b>, and it cannot be entered without the manifest the operator
     * approved. There is no overload that takes ids as loose strings, none that builds an approval internally, and
     * none that sends with no approval at all: {@code transport.post} appears exactly once in this file, inside the
     * loop below, and this is the only method that reaches it with {@link Mode#RUN}.
     *
     * <p><b>The order is the contract</b> (§23.9):
     *
     * <ol>
     *   <li>recompute every bound field <b>from the world</b> — git, the live prompt, the live schema, the inputs in
     *       hand — and never from anything PREPARE cached;</li>
     *   <li>ask {@link GoalRunGuard#refusals};</li>
     *   <li>refuse, or continue;</li>
     *   <li>refuse if the credential is absent;</li>
     *   <li>refuse if the output already exists;</li>
     *   <li>only then, the first send.</li>
     * </ol>
     *
     * <p>Any refusal leaves the send count at <b>exactly zero</b>. Nothing partial starts, because nothing has
     * started: the checks are all above the loop.
     *
     * @throws Refused with the reasons, which never include a value that could be a secret
     */
    public Result send(ApprovalManifest approval, World world, List<Input> inputs, Sink sink) {
        if (approval == null) {
            throw new IllegalArgumentException("RUN requires the approved manifest");
        }
        if (world == null || sink == null || inputs == null) {
            throw new IllegalArgumentException("RUN names where it runs, what it sends and where rows go");
        }
        List<Request> requests = prepare(inputs);
        List<String> refusals = GoalRunGuard.refusals(approval.approvalId(), approval.runId(), approval.bound(),
                world.grantedApprovalId(), world.grantedRunId(), current(world.repoRoot(), inputs, requests));
        if (!refusals.isEmpty()) {
            throw new Refused(refusals);
        }
        String credential = headers.get(AUTHORIZATION);
        if (credential == null || credential.isBlank()) {
            // Presence only. This never asks whether the credential is GOOD — that is the vendor's answer, and it
            // costs a call to get, which is exactly what an unapproved or misconfigured run must not spend.
            throw new Refused(List.of("CREDENTIAL_MISSING:" + AUTHORIZATION));
        }
        if (world.out() != null && Files.exists(world.out())) {
            throw new Refused(List.of("OUTPUT_EXISTS:" + world.out().getFileName()));
        }
        return loop(approval.runId(), Mode.RUN, inputs, approval.hardCap(), Map.of(), sink, requests);
    }

    /**
     * Every bound field, read from the world at this moment.
     *
     * <p><b>Nothing here is carried over from PREPARE.</b> The commit and the tree come from git now; the prompt and
     * schema fingerprints are computed from the live classes now; the input-set and request fingerprints are computed
     * from the inputs actually in hand now. A manifest that agreed with a cached copy of itself would agree with
     * anything.
     */
    private Map<String, String> current(Path repoRoot, List<Input> inputs, List<Request> requests) {
        Map<String, String> m = new java.util.LinkedHashMap<>();
        m.put("commit", RepoState.commit(repoRoot));
        m.put("tree_clean", String.valueOf(RepoState.clean(repoRoot)));
        m.put("runner", VERSION);
        m.put("prompt_version", CustomerGoalPrompt.VERSION);
        m.put("system_fp", CustomerGoalPrompt.sha256(CustomerGoalPrompt.system()));
        m.put("schema_fp", CustomerGoalPrompt.sha256(CustomerGoalPrompt.schema().toString()));
        m.put("input_set_fp", inputSetFp(inputs));
        m.put("request_fp_set", requestFpSet(requests));
        m.put("model", model);
        m.put("reasoning_effort", reasoningEffort);
        // One request per input, so the number of inputs IS the number of calls this run can make and the ceiling
        // it can reach. Handing the runner more inputs than were approved moves both and is refused.
        m.put("calls", String.valueOf(inputs.size()));
        m.put("hard_cap", String.valueOf(inputs.size()));
        m.put("retry_policy", ApprovalManifest.NO_RETRY);
        m.put("scope", SCOPE);
        // Asked of the transport this run is holding, not of a field describing it. An approval for a rehearsal
        // cannot drive a vendor and an approval for a vendor cannot be spent on a rehearsal, because the tool is
        // part of the manifest (live approval contract §4).
        m.put("transport", GoalTransport.modeOf(transport));
        return m;
    }

    /** The one formula for "these inputs", shared with the preflight so the two cannot drift. */
    public static String inputSetFp(List<Input> inputs) {
        return sha(String.join("\n", inputs.stream().map(i -> i.id() + "\u0000" + i.message()).toList()));
    }

    /** The one formula for "these requests". */
    public static String requestFpSet(List<Request> requests) {
        return sha(String.join("\n", requests.stream().map(Request::requestFp).toList()));
    }

    private Result loop(String runId, Mode mode, List<Input> inputs, int maxCalls, Map<String, JsonNode> recorded,
                        Sink sink, List<Request> prepared) {
        List<String> out = new ArrayList<>();
        int calls = 0;
        for (Request request : prepared == null ? prepare(inputs) : prepared) {
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
                    // Defence in depth: the guard already agreed the count, and the cap is still checked per send.
                    GoalRunGuard.checkCap(calls, maxCalls);
                    AgentLlmTransport.Response response = transport.post(endpoint, headers, request.body());
                    calls++;
                    Envelope envelope = Envelope.of(response);
                    content = envelope.content();
                    said = envelope.said();
                    failure = envelope.failure();
                    finish = envelope.finish();
                    elapsed = response == null ? 0 : response.elapsedMs();
                }
            }
            // Raw first, and durable first. Everything after this line is derived, and a derivation that throws
            // must not be able to take the observation with it — a recorded answer cannot be produced a second time.
            sink.raw(raw(runId, mode, request, content, said, failure, finish, elapsed));
            String row = row(runId, mode, request, content, said, failure, finish, elapsed);
            sink.row(row);
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
     * The observation, with <b>nothing derived from it</b>: identity, fingerprints, what came back and how it ended.
     * This is what reaches durable storage first, so a parser that throws cannot take an answer down with it.
     */
    private String raw(String runId, Mode mode, Request request, String content, String said, String failure,
                       String finish, long elapsedMs) {
        return head(runId, mode, request, content, said, failure, finish, elapsedMs).toString();
    }

    private ObjectNode head(String runId, Mode mode, Request request, String content, String said, String failure,
                            String finish, long elapsedMs) {
        ObjectNode row = JSON.createObjectNode();
        row.put("run_id", runId).put("mode", mode.name()).put("id", request.id());
        row.put("runner", VERSION).put("prompt_version", CustomerGoalPrompt.VERSION)
                .put("model", model).put("reasoning_effort", reasoningEffort);
        // Which tool answered. On every row, so a rehearsal artifact can never be read as a model result later —
        // including by a reader who has only the rows and not the manifest that authorized them.
        row.put("transport", GoalTransport.modeOf(transport));
        row.put("system_fp", CustomerGoalPrompt.sha256(CustomerGoalPrompt.system()))
                .put("schema_fp", CustomerGoalPrompt.sha256(CustomerGoalPrompt.schema().toString()))
                .put("input_fp", sha(request.user())).put("request_fp", request.requestFp());
        row.put("elapsed_ms", elapsedMs);
        row.put("finish", finish);
        row.put("raw", content);
        row.put("said", said);
        row.put("failure", failure);
        return row;
    }

    /**
     * One row. {@code raw} is the answer that may be read as a goal set and {@code said} is what the vendor sent —
     * the same string on success, and different exactly where a call failed with something in hand.
     */
    private String row(String runId, Mode mode, Request request, String content, String said, String failure,
                       String finish, long elapsedMs) {
        ObjectNode row = head(runId, mode, request, content, said, failure, finish, elapsedMs);
        if (content == null) {
            row.putNull("goals");
            row.putArray("relations");
            row.put("valid", false);
            return row.toString();
        }
        Parsed parsed = parse(content, customerOf(request));
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
     * The customer's message, read back out of the request that was actually sent.
     *
     * <p>Taken from {@link Request#user()} rather than threaded in beside it, so the text a quote is checked against
     * is <b>the text the model was shown</b>, byte for byte. A second copy carried alongside could disagree with the
     * payload, and then a failed quote check would be evidence about our plumbing rather than about the answer.
     */
    private static String customerOf(Request request) {
        try {
            return JSON.readTree(request.user()).path("customer").asText(null);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Content that arrived and may be read. Three ways it can still be refused: it is not JSON of the declared shape
     * ({@code GOAL_UNPARSEABLE}); it is JSON that the contract will not construct ({@code GOAL_CONTRACT}) — an
     * outcome outside the four, a request longer than a request, a relation with no clause behind it, a goal with no
     * quote, two goals quoting one clause, a second inference; or every record builds and a goal's quote turns out
     * not to be in the customer's message ({@code GOAL_EVIDENCE}).
     *
     * <p>The first two are checked by <b>building the real records</b> rather than by a second copy of their rules.
     * The third is separate because it is the one rule the records cannot hold: only here is the message in hand.
     * It is also worth its own name — a model that quotes something the customer never wrote has failed differently
     * from one that returned a malformed object, and a single {@code GOAL_CONTRACT} bucket would hide that.
     */
    private static Parsed parse(String content, String customerMessage) {
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
                        RequestBasis.valueOf(g.path("basis").asText()), constraints,
                        g.path("evidence").asText(null)));
            }
            List<GoalRelation> relations = new ArrayList<>();
            if (root.has("relations")) {
                for (JsonNode r : root.get("relations")) {
                    relations.add(new GoalRelation(GoalRelation.Kind.valueOf(r.path("kind").asText()),
                            r.path("primary_goal_id").asText(), r.path("fallback_goal_id").asText(),
                            r.path("stated_condition").asText()));
                }
            }
            // The set's own rules: ids, one fallback each, no cycles, one clause per goal, one inference per message.
            CustomerGoalSet set = new CustomerGoalSet(goals, relations);
            if (!set.unquoted(customerMessage).isEmpty()) {
                return new Parsed(null, null, "GOAL_EVIDENCE");
            }
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
