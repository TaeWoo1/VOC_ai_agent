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

    /**
     * What this mode needs from the shell.
     *
     * <p>A rehearsal does not need an endpoint, because it does not have one to configure: {@link GoalTransport}
     * uses a constant no client will dial, and demanding a URL that is then ignored would invite an operator to
     * supply the vendor's and believe it mattered. The <b>credential is still required</b> in both modes — proving
     * that a value put on the command line reaches the transport is most of what a rehearsal is for.
     */
    public static List<String> requiredEnv(GoalTransport.Mode mode) {
        return mode == GoalTransport.Mode.FAKE ? List.of("SELLEROPS_INQUIRY_GOAL_API_KEY") : REQUIRED_ENV;
    }

    /** The durable eval store. Read at runtime for the one real message; never copied into the repository. */
    public static Path storeRoot(Map<String, String> env) {
        String configured = env.get("SELLEROPS_EVAL_CACHE");
        return configured != null && !configured.isBlank() ? Path.of(configured)
                : Path.of(System.getProperty("user.home"), ".cache", "sellerops-eval");
    }

    public static final String MODEL = "gpt-5-2025-08-07";
    public static final String REASONING_EFFORT = "minimal";
    /** The runner defines what it does; the preflight quotes it, so the two cannot describe different runs. */
    public static final String SCOPE = CustomerGoalRunner.SCOPE;

    private GoalInterpreterPreflight() {
    }

    /**
     * <b>The operator's PREPARE command</b> (Inquiry v3.5 §24.1), invoked by the {@code prepareGoalSmoke} Gradle
     * task on the test runtime classpath.
     *
     * <p>It exists because the manifests before it were lifted out of a <i>test artifact</i> — which works, and
     * quietly makes the approval an operator grants against a by-product of running the suite. A decision point
     * deserves a command of its own, and a file it can be pointed at.
     *
     * <p>Writes {@code PREFLIGHT.json} always and {@code APPROVAL.json} only when the verdict is ready: there is no
     * outcome in which a blocked preflight leaves something that looks bindable lying next to it. Both are
     * {@code CREATE_NEW}. Exit {@code 0} ready, {@code 2} blocked.
     *
     * <p><b>Zero vendor calls</b> — this is the path that decides whether transport would work, without doing any.
     */
    public static void main(String[] argv) throws Exception {
        Map<String, String> named = new LinkedHashMap<>();
        for (int i = 0; i + 1 < argv.length; i += 2) {
            named.put(argv[i].replaceFirst("^--", ""), argv[i + 1]);
        }
        Path repoRoot = Path.of(named.getOrDefault("repo", ".."));
        Path out = Path.of(named.getOrDefault("out", "build/goal-smoke"));
        Files.createDirectories(out);

        String planName = named.getOrDefault("plan", GoalSmokeInputs.CONTRACT_SMOKE.name());
        GoalSmokeInputs.Plan plan = GoalSmokeInputs.PLANS.get(planName);
        if (plan == null) {
            System.out.println("UNKNOWN PLAN " + planName + " \u2014 known plans: "
                    + new java.util.TreeSet<>(GoalSmokeInputs.PLANS.keySet()));
            System.exit(2);
        }
        Outcome outcome = prepare(repoRoot, System.getenv(), null, plan);
        Files.writeString(out.resolve("PREFLIGHT.json"), outcome.report().toPrettyString() + "\n",
                java.nio.file.StandardOpenOption.CREATE_NEW);
        if (!outcome.ready()) {
            System.out.println(outcome.report().toPrettyString());
            System.out.println("\nBLOCKED — no manifest was written. Nothing here can be approved.");
            System.exit(2);
        }
        Path manifest = out.resolve("APPROVAL.json");
        outcome.manifest().write(manifest);
        System.out.println(outcome.report().toPrettyString());
        System.out.println("\nREADY_FOR_APPROVAL — manifest written to " + manifest.toAbsolutePath());
        System.out.println("approval_id " + outcome.manifest().approvalId());
        System.out.println("run_id      " + outcome.manifest().runId());
        System.out.println("transport   " + outcome.manifest().transport());
        System.out.println("\nThis is NOT an approval. A grant binds to those two ids, and ANY commit made after "
                + "this moment revokes it.");
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
        return prepare(repoRoot, env, null, GoalSmokeInputs.CONTRACT_SMOKE);
    }


    /**
     * @param supplied an input set to use instead of the committed one. Tests pass a complete set so that the
     *                 READY path is exercised by the same code the real preflight runs; production passes null and
     *                 the set is assembled from committed bytes.
     */
    public static Outcome prepare(Path repoRoot, Map<String, String> env, GoalSmokeInputs.Set supplied)
            throws Exception {
        return prepare(repoRoot, env, supplied, GoalSmokeInputs.CONTRACT_SMOKE);
    }


    public static Outcome prepare(Path repoRoot, Map<String, String> env, GoalSmokeInputs.Set supplied,
                                  GoalSmokeInputs.Plan plan) throws Exception {
        List<String> blockers = new ArrayList<>();
        ObjectNode report = JSON.createObjectNode();
        report.put("kind", "GOAL_INTERPRETER_PREFLIGHT").put("prepared_at", Instant.now().toString());

        String commit = RepoState.commit(repoRoot);
        boolean clean = RepoState.clean(repoRoot);
        report.put("commit", commit).put("tree_clean", clean);
        if (!clean) {
            blockers.add("TREE_NOT_CLEAN — a run must be attributable to a commit");
        }

        Path fixture = repoRoot.resolve("contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl");
        GoalSmokeInputs.Set set = supplied == null
                ? GoalSmokeInputs.assemble(fixture, storeRoot(env), plan) : supplied;
        ObjectNode inputs = report.putObject("inputs");
        inputs.put("plan", plan.name());
        inputs.put("plan_why", plan.why());
        inputs.put("fixture", "contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl");
        inputs.put("fixture_sha256", CustomerGoalRunner.sha(Files.readString(fixture)));
        // Git fixtures plus the real messages from the store, counted as ONE number so the two halves cannot read
        // as a shortfall the way an earlier report's "13" did. It comes from the plan, never from a constant here:
        // a manifest that says "14" while six calls go out is the shape this field exists to make impossible.
        inputs.put("planned", plan.planned());
        inputs.put("from_committed_fixture", plan.fixtureIds().size());
        inputs.put("from_durable_store", plan.storeIds().size());
        inputs.put("usable", set.usable().size());
        inputs.put("real_customer_text", set.realCustomerText());
        inputs.put("store_root_configured", env.containsKey("SELLEROPS_EVAL_CACHE"));
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
        // The same two formulas the runner re-computes at send time. One definition, or a manifest agrees with a
        // fingerprint nobody else would have produced.
        String inputSetFp = CustomerGoalRunner.inputSetFp(usable);
        String requestFpSet = CustomerGoalRunner.requestFpSet(requests);

        // Which tool this manifest would be spent on. A rehearsal manifest and a real one are different approvals
        // and the guard refuses to cross them; recorded here so the operator reading the manifest sees which they
        // are granting rather than inferring it from the surrounding conversation.
        GoalTransport.Mode transport = GoalTransport.mode(env);
        report.put("transport", transport.name());

        Map<String, String> environment = new LinkedHashMap<>();
        for (String name : requiredEnv(transport)) {
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
                ApprovalManifest.NO_RETRY, SCOPE, transport.name(), set.realCustomerText(),
                requests.stream().map(CustomerGoalRunner.Request::id).toList(),
                requests.stream().map(CustomerGoalRunner.Request::requestFp).toList(),
                environment, "eval-store:runs/" + runId, estimate(requests), notes(set, transport));
        report.set("manifest", manifest.toJson());
        return new Outcome(manifest, List.of(), report);
    }

    /** What a reader of this manifest has to know and could not work out from the numbers. */
    private static List<String> notes(GoalSmokeInputs.Set set, GoalTransport.Mode transport) {
        List<String> notes = new ArrayList<>();
        if (transport == GoalTransport.Mode.FAKE) {
            notes.add("REHEARSAL MANIFEST — transport=FAKE. This approval authorizes an EXECUTION REHEARSAL against "
                    + "a deterministic in-process fake that cannot reach a network, and it CANNOT be spent on a "
                    + "vendor: transport is a bound field, so a real run reading this manifest is refused. Any "
                    + "metric produced under it describes the harness and NOT a model.");
        }
        notes.add("Environment presence was established from the invoking shell at preflight time. The preflight "
                + "NEVER READS THE VALUES — it answers 'would transport be configured', never 'is this credential "
                + "good'. A wrong value fails at transport on the first call, with nothing billed.");
        if (set.realCustomerText()) {
            notes.add("This input set carries REAL CUSTOMER TEXT: " + GoalSmokeInputs.NO_GOAL_CASE + " is read from "
                    + "the durable eval store at runtime and is not in git. The manifest carries its id and the "
                    + "fingerprints of the request built from it, and nowhere carries the message itself.");
        }
        return List.copyOf(notes);
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

}
