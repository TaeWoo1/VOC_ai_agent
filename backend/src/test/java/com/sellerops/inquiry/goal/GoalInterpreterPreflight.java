package com.sellerops.inquiry.goal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * <b>The preflight</b> (Inquiry v3.5): everything that has to be true before anybody may be asked for an approval,
 * done without contacting a vendor.
 *
 * <p>It ends in one of two places and never in between. Either it emits an {@link ApprovalManifest} carrying an
 * {@code approvalId}, a {@code runId} and the exact fingerprints of the bytes that would go out — the only thing a
 * grant can bind to — or it emits a <b>blocked report naming exactly what is missing</b>. There is no third outcome
 * where a manifest is produced with a hole in it, because a manifest with a hole is how an approval comes to mean
 * less than the operator thought it meant.
 *
 * <h2>Environment</h2>
 *
 * <p>Configuration is read from the <b>process environment only</b>. Not from {@code .env.local} in this or any
 * other worktree, not from a sibling checkout, not from anything repo-relative: a harness that goes looking for
 * secrets is a harness that can find the wrong ones, and the operator's own shell is the one place they can mean to
 * put them. What the manifest records is the variable NAME and {@code PRESENT} or {@code MISSING} — never a value,
 * a prefix, a length or a hash, because a hash of a short secret is a secret with one extra step.
 *
 * <p>Injecting the value for an approved run is a launch concern. This class's job is to say, before transport is
 * possible, whether it would work.
 */
public final class GoalInterpreterPreflight {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Its own key and its own endpoint, like every other capability in this repository. No default vendor URL. */
    public static final List<String> REQUIRED_ENV = List.of("SELLEROPS_INQUIRY_GOAL_API_KEY",
            "SELLEROPS_INQUIRY_GOAL_ENDPOINT");

    public static final String MODEL = "gpt-5-2025-08-07";
    public static final String REASONING_EFFORT = "minimal";
    public static final String SCOPE = "offline synthetic smoke — Customer Goal Interpreter, no seller and no channel";

    private GoalInterpreterPreflight() {
    }

    public record Outcome(ApprovalManifest manifest, List<String> blockers, ObjectNode report) {
        public boolean ready() {
            return manifest != null && blockers.isEmpty();
        }
    }

    /**
     * @param repoRoot the worktree the run would execute from
     * @param env      the process environment, passed in so a test can supply one without setting any
     */
    public static Outcome prepare(Path repoRoot, Map<String, String> env) throws Exception {
        return prepare(repoRoot, env, null);
    }

    /**
     * @param supplied an input set to use instead of the committed one. Tests pass a complete set so that the
     *                 READY path is exercised by the same code the real preflight runs; production passes null and
     *                 the set is assembled from committed bytes.
     */
    public static Outcome prepare(Path repoRoot, Map<String, String> env, GoalSmokeInputs.Set supplied)
            throws Exception {
        List<String> blockers = new ArrayList<>();
        ObjectNode report = JSON.createObjectNode();
        report.put("kind", "GOAL_INTERPRETER_PREFLIGHT").put("prepared_at", Instant.now().toString());

        String commit = git(repoRoot, "rev-parse", "HEAD");
        String dirty = git(repoRoot, "status", "--porcelain");
        boolean clean = dirty.lines().filter(l -> !l.isBlank())
                .noneMatch(l -> !l.contains("node_modules"));
        report.put("commit", commit).put("tree_clean", clean);
        if (!clean) {
            blockers.add("TREE_NOT_CLEAN — a run must be attributable to a commit");
        }

        Path fixture = repoRoot.resolve("contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl");
        GoalSmokeInputs.Set set = supplied == null ? GoalSmokeInputs.assemble(fixture) : supplied;
        ObjectNode inputs = report.putObject("inputs");
        inputs.put("fixture", "contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl");
        inputs.put("fixture_sha256", CustomerGoalRunner.sha(Files.readString(fixture)));
        inputs.put("chosen", GoalSmokeInputs.CHOSEN.size());
        inputs.put("usable", set.usable().size());
        ArrayNode notDerivable = inputs.putArray("not_derivable");
        set.inputs().stream().filter(i -> !i.derivable())
                .forEach(i -> notDerivable.addObject().put("id", i.id()).put("why", i.why()));
        ArrayNode missing = inputs.putArray("missing");
        set.missing().forEach(missing::add);
        ObjectNode coverage = report.putObject("coverage");
        set.coverage().forEach(coverage::put);

        set.missing().forEach(m -> blockers.add("INPUT_MISSING — " + m));
        set.inputs().stream().filter(i -> !i.derivable())
                .forEach(i -> blockers.add("INPUT_NOT_DERIVABLE — " + i.id() + ": " + i.why()));
        set.coverage().forEach((k, v) -> {
            if (v.startsWith("MISSING")) {
                blockers.add("COVERAGE — " + k + ": " + v);
            }
        });

        // Fingerprints are of the bytes that would actually be sent, built by the runner's own prepare path.
        CustomerGoalRunner runner = new CustomerGoalRunner(MODEL, REASONING_EFFORT, refusing(), null);
        List<CustomerGoalRunner.Input> usable = set.usable().stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList();
        List<CustomerGoalRunner.Request> requests = runner.prepare(usable);
        String inputSetFp = CustomerGoalRunner.sha(String.join("\n",
                usable.stream().map(i -> i.id() + "\u0000" + i.message()).toList()));
        String requestFpSet = CustomerGoalRunner.sha(String.join("\n",
                requests.stream().map(CustomerGoalRunner.Request::requestFp).toList()));

        Map<String, String> environment = new LinkedHashMap<>();
        for (String name : REQUIRED_ENV) {
            String value = env.get(name);
            boolean present = value != null && !value.isBlank();
            environment.put(name, present ? "PRESENT" : "MISSING");
            if (!present) {
                blockers.add("ENV_MISSING — " + name);
            }
        }
        ObjectNode envNode = report.putObject("environment");
        environment.forEach(envNode::put);

        ArrayNode blocked = report.putArray("blockers");
        blockers.forEach(blocked::add);
        report.put("verdict", blockers.isEmpty() ? "READY_FOR_APPROVAL" : "BLOCKED");

        if (!blockers.isEmpty()) {
            return new Outcome(null, List.copyOf(blockers), report);
        }
        String runId = "v35-goal-smoke-" + commit.substring(0, 8) + "-"
                + UUID.randomUUID().toString().substring(0, 8);
        ApprovalManifest manifest = new ApprovalManifest(
                "apr-" + UUID.randomUUID(), runId, Instant.now().toString(), commit, clean,
                CustomerGoalRunner.VERSION, CustomerGoalPrompt.VERSION,
                CustomerGoalPrompt.sha256(CustomerGoalPrompt.system()),
                CustomerGoalPrompt.sha256(CustomerGoalPrompt.schema().toString()),
                inputSetFp, requestFpSet, MODEL, REASONING_EFFORT, requests.size(), requests.size(),
                ApprovalManifest.NO_RETRY, SCOPE, false,
                requests.stream().map(CustomerGoalRunner.Request::id).toList(),
                requests.stream().map(CustomerGoalRunner.Request::requestFp).toList(),
                environment, "eval-store:runs/" + runId, estimate(requests), List.of());
        report.set("manifest", manifest.toJson());
        return new Outcome(manifest, List.of(), report);
    }

    /** Extrapolated from the v5 planner baseline and labelled as such wherever it is printed. */
    private static Map<String, Object> estimate(List<CustomerGoalRunner.Request> requests) {
        int bytes = requests.stream().mapToInt(r -> r.body().length()).sum();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("calls", requests.size());
        m.put("request_bytes_total", bytes);
        m.put("prompt_tokens_per_call_estimated", "500-800");
        m.put("completion_tokens_per_call_estimated", "50-110");
        return m;
    }

    /** A transport that refuses to be used. PREPARE never touches it, and this is how that is true rather than said. */
    private static com.sellerops.agent.llm.AgentLlmTransport refusing() {
        return (uri, headers, json) -> {
            throw new IllegalStateException("PREPARE must not contact a vendor");
        };
    }

    private static String git(Path repoRoot, String... args) throws Exception {
        List<String> command = new ArrayList<>(List.of("git"));
        command.addAll(List.of(args));
        Process process = new ProcessBuilder(command).directory(repoRoot.toFile())
                .redirectErrorStream(true).start();
        String out = new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        process.waitFor();
        return out.trim();
    }
}
