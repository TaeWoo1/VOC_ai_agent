package com.sellerops.inquiry.goal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.io.BufferedWriter;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <b>The one way to actually run the smoke</b> (Inquiry v3.5 §23.9, completed in §23.10).
 *
 * <p>It exists because the package before it built modes and a guard and no way to use them: the binding an operator
 * grants against was tested nine ways and wired into nothing, so "running with the approval" would have meant
 * running <i>beside</i> it. This is the entrypoint, and <b>every decision about whether the run may happen is the
 * runner's, not this class's</b>, so there is no second place to get it wrong.
 *
 * <p><b>Test tree, on purpose.</b> The interpreter still has no production caller, and a sender in {@code main}
 * would quietly make that untrue. Nothing here is reachable from the application; the Gradle task that invokes it
 * runs on the <i>test</i> runtime classpath for exactly that reason.
 *
 * <h2>One command, the whole path</h2>
 *
 * <pre>
 *   SELLEROPS_INQUIRY_GOAL_API_KEY='...' \
 *   SELLEROPS_INQUIRY_GOAL_ENDPOINT='https://...' \
 *   ./gradlew -p backend runGoalSmoke --args='--approval &lt;manifest&gt; \
 *       --granted-approval apr-... --granted-run &lt;run-id&gt; --out &lt;a new directory&gt;'
 * </pre>
 *
 * <p>and that single invocation covers environment read, manifest load, frozen input assembly, recomputation of every
 * bound field from the world, the guard, the credential and collision checks, transport, raw streaming, derived rows,
 * scoring, storage and verification, ending in a report. <b>Nothing is left for an operator to remember</b>: the
 * previous version of this class finished by printing "next: run store.mjs", which made a run's durability depend on
 * someone reading the last line of a long log at the one moment the artifacts cannot be produced again.
 *
 * <p>The two granted ids are typed by the operator and compared against the file. Comparing the file to itself would
 * prove nothing; the thing worth catching is a launcher aimed at a manifest the operator never read.
 */
public final class GoalRunLauncher {

    /** The credential's variable. Read from the process environment, handed to the transport, never anywhere else. */
    public static final String CREDENTIAL_ENV = "SELLEROPS_INQUIRY_GOAL_API_KEY";
    public static final String ENDPOINT_ENV = "SELLEROPS_INQUIRY_GOAL_ENDPOINT";

    /**
     * Written immediately before the first send, and nowhere else.
     *
     * <p>That instant is where the live approval contract §4 puts {@code CONSUMED} — "the first <i>permitted</i> live
     * action ran" — so this file is the run's record of having spent its approval. Everything that can refuse
     * happens above it, which is why a refused run leaves an empty directory and an interrupted one leaves this.
     */
    static final String STARTED = "RUN_STARTED.json";

    /** Written when the send loop has finished and every observation is durable. Its absence means incomplete. */
    static final String COMPLETE = "RUN_COMPLETE.json";

    private static final ObjectMapper JSON = new ObjectMapper();

    private GoalRunLauncher() {
    }

    public record Args(Path approval, String grantedApprovalId, String grantedRunId, Path out, Path repoRoot) {
    }

    public static void main(String[] argv) throws Exception {
        Map<String, String> named = new LinkedHashMap<>();
        for (int i = 0; i + 1 < argv.length; i += 2) {
            named.put(argv[i].replaceFirst("^--", ""), argv[i + 1]);
        }
        Args args = new Args(Path.of(named.getOrDefault("approval", "")),
                named.getOrDefault("granted-approval", ""), named.getOrDefault("granted-run", ""),
                Path.of(named.getOrDefault("out", "")), Path.of(named.getOrDefault("repo", "..")));
        try {
            ObjectNode report = launch(args, System.getenv(), null);
            System.out.println(report.toPrettyString());
            System.exit("COMPLETE".equals(report.path("status").asText()) ? 0 : 4);
        } catch (CustomerGoalRunner.Refused refused) {
            // Reasons only. A refusal names the field that moved and never carries a value.
            ObjectNode report = JSON.createObjectNode();
            report.put("kind", "GOAL_SMOKE_RUN_REPORT").put("status", "REFUSED").put("calls_attempted", 0);
            report.put("approval_id", args.grantedApprovalId()).put("run_id", args.grantedRunId());
            var reasons = report.putArray("refusals");
            refused.reasons().forEach(reasons::add);
            System.out.println(report.toPrettyString());
            System.exit(3);
        }
    }

    /**
     * @param env       the process environment. <b>Nothing repo-relative is ever read</b> — no {@code .env}, no
     *                  {@code .env.local}, not in this worktree and not in any other. A harness that goes looking
     *                  for credentials is a harness that can find the wrong ones.
     * @param transport the transport to use, or null to build the one the environment selects. A test passes one;
     *                  the operator command passes null and gets {@link GoalTransport#of}.
     * @return the run report, carrying no secret in any field
     */
    public static ObjectNode launch(Args args, Map<String, String> env, AgentLlmTransport transport) throws Exception {
        ApprovalManifest approval = ApprovalManifest.read(args.approval());

        GoalTransport.Mode mode = GoalTransport.mode(env);
        // REAL demands the operator's endpoint and refuses without one, before anything is constructed. FAKE uses a
        // constant that no client will dial, so a rehearsal cannot be aimed at a vendor by a variable left over
        // from a previous run.
        URI endpoint = GoalTransport.endpoint(mode, env);
        AgentLlmTransport wire = transport == null ? GoalTransport.of(mode, env) : transport;

        // The credential is moved from the environment into the header and is not looked at on the way past. The
        // runner refuses an absent one before it sends; nothing here, or there, reads its value.
        String credential = env.get(CREDENTIAL_ENV);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        if (credential != null && !credential.isBlank()) {
            headers.put(CustomerGoalRunner.AUTHORIZATION, "Bearer " + credential);
        }

        // The inputs the APPROVED manifest names, in its order. Not a re-assembly of whichever plan this class
        // happens to default to: the guard binds input_set_fp and request_fp_set, so a re-assembly could never send
        // the WRONG set — but it could only ever send the default one, which made every other approved plan
        // unspendable. The manifest is the document the operator read, so the manifest decides.
        GoalSmokeInputs.Set set = GoalSmokeInputs.forIds(
                args.repoRoot().resolve("contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl"),
                GoalInterpreterPreflight.storeRoot(env), approval.inputIds());
        if (!set.complete()) {
            // Refused before anything is constructed. An input this machine cannot rebuild does not make a smaller
            // run, it makes a different one — and the fingerprints would say so a moment later anyway.
            throw new CustomerGoalRunner.Refused(set.missing().stream().map(m -> "INPUT_MISSING:" + m).toList());
        }
        List<CustomerGoalRunner.Input> inputs = set.usable().stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList();

        Files.createDirectories(args.out());
        Path rawFile = args.out().resolve("raw.jsonl");
        Path rowFile = args.out().resolve("rows.jsonl");
        CustomerGoalRunner runner = new CustomerGoalRunner(approval.model(), approval.reasoningEffort(),
                wire, endpoint, headers);

        CustomerGoalRunner.Result result;
        try (Streaming sink = new Streaming(rawFile, rowFile,
                () -> started(args, approval, inputs.size(), GoalTransport.modeOf(wire)))) {
            result = runner.send(approval, new CustomerGoalRunner.World(args.repoRoot(),
                    args.grantedApprovalId(), args.grantedRunId(), rowFile), inputs, sink);
        }
        // Reached only when every send returned and every row is on disk. A process that died mid-run never writes
        // this, and the directory it leaves says STARTED and not COMPLETE — which is the difference between an
        // incomplete run and a finished one, stated rather than inferred from a file count.
        complete(args, result.calls());

        List<GoalRunFinalizer.Step> steps = GoalRunFinalizer.finish(args.repoRoot(), args.grantedRunId(),
                args.out(), GoalInterpreterPreflight.storeRoot(env), GoalTransport.modeOf(wire), env);
        return report(args, approval, result, GoalTransport.modeOf(wire), steps, rawFile, args.out());
    }

    /** The consumption record, written at the instant the approval is spent and never rewritten. */
    private static void started(Args args, ApprovalManifest approval, int planned, String transport) {
        ObjectNode node = JSON.createObjectNode();
        node.put("kind", "GOAL_SMOKE_RUN_STARTED").put("at", Instant.now().toString());
        node.put("approval_id", approval.approvalId()).put("run_id", approval.runId());
        node.put("commit", approval.commit()).put("transport", transport);
        node.put("planned_calls", planned).put("hard_cap", approval.hardCap());
        node.put("approval_state", "CONSUMED — the first permitted live action began "
                + "(docs/sellerops_live_approval_contract.md §4)");
        write(args.out().resolve(STARTED), node);
    }

    private static void complete(Args args, int calls) {
        ObjectNode node = JSON.createObjectNode();
        node.put("kind", "GOAL_SMOKE_RUN_COMPLETE").put("at", Instant.now().toString());
        node.put("calls_completed", calls);
        write(args.out().resolve(COMPLETE), node);
    }

    private static void write(Path file, ObjectNode node) {
        try {
            Files.writeString(file, node.toPrettyString() + "\n", StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW);
        } catch (Exception e) {
            throw new IllegalStateException("a run state file could not be created: " + file.getFileName(), e);
        }
    }

    /**
     * What happened, in one place, with no secret in any field.
     *
     * <p>A {@code FAKE} run says so in three ways — the transport line, the explicit
     * {@code execution rehearsal only} verdict, and the suppression of anything that would read as a model result —
     * because a rehearsal artifact that looks like a measurement is how a harness number becomes a quoted score.
     */
    private static ObjectNode report(Args args, ApprovalManifest approval, CustomerGoalRunner.Result result,
                                     String transport, List<GoalRunFinalizer.Step> steps, Path raw, Path out)
            throws Exception {
        ObjectNode node = JSON.createObjectNode();
        node.put("kind", "GOAL_SMOKE_RUN_REPORT").put("status", "COMPLETE");
        node.put("run_id", approval.runId()).put("approval_id", approval.approvalId());
        node.put("commit", approval.commit()).put("transport", transport);
        node.put("calls_attempted", result.calls()).put("calls_completed", result.calls());

        Map<String, Integer> failures = new LinkedHashMap<>();
        int vendor = 0;
        int reading = 0;
        for (String row : result.rows()) {
            var parsed = JSON.readTree(row);
            String failure = parsed.path("failure").isNull() ? null : parsed.path("failure").asText();
            if (failure == null) {
                continue;
            }
            failures.merge(failure, 1, Integer::sum);
            if (failure.startsWith("GOAL_")) {
                reading++;
            } else {
                vendor++;
            }
        }
        node.put("vendor_failures", vendor).put("parse_or_contract_failures", reading);
        ObjectNode byKind = node.putObject("failures_by_kind");
        failures.forEach(byKind::put);

        node.put("hard_cap", approval.hardCap()).put("retry_policy", approval.retryPolicy());
        node.put("raw_artifact", raw.toString());
        node.put("score_artifact", out.resolve("score.json").toString());
        node.put("run_started_marker", out.resolve(STARTED).toString());
        node.put("run_complete_marker", out.resolve(COMPLETE).toString());
        node.put("run_incomplete", !Files.exists(out.resolve(COMPLETE)));
        ObjectNode finalizers = node.putObject("finalization");
        GoalRunFinalizer.asMap(steps).forEach(finalizers::put);
        node.put("run_verify", steps.stream().filter(s -> "run-verify".equals(s.name())).findFirst()
                .map(s -> s.ok() ? "ok" : "FAILED").orElse("not attempted"));
        node.put("approval_state", "CONSUMED — a permitted live action ran");
        node.put("metrics_meaning", GoalTransport.Mode.FAKE.name().equals(transport)
                ? "EXECUTION REHEARSAL ONLY — every answer came from a deterministic in-process fake. Any score "
                + "under this run measures the harness and says NOTHING about a model."
                : "model results — answers came from " + approval.model() + " at "
                + approval.reasoningEffort() + " reasoning effort");
        node.put("approval_path", args.approval().toString());
        return node;
    }

    /**
     * Rows reach the disk as the run progresses, raw first and flushed immediately.
     *
     * <p>Buffering a run and writing it at the end means a process that dies halfway recorded nothing, and a vendor
     * answer cannot be produced a second time. Both files are {@code CREATE_NEW}, and both are opened <b>on the
     * first row</b> — so a refused run leaves no files behind at all, and the runner's own "this output already
     * exists" check is not tripped by the writer that was going to serve it.
     *
     * <p>The same first row triggers {@code onFirstRow}, which is where the consumption marker is written: that is
     * the earliest moment at which a send has certainly happened, and it is written before the observation it
     * accompanies is even finished being stored.
     */
    static final class Streaming implements CustomerGoalRunner.Sink, AutoCloseable {
        private final Path rawFile;
        private final Path rowFile;
        private final Runnable onFirstRow;
        private BufferedWriter raw;
        private BufferedWriter rows;
        private boolean announced;

        Streaming(Path rawFile, Path rowFile) {
            this(rawFile, rowFile, null);
        }

        Streaming(Path rawFile, Path rowFile, Runnable onFirstRow) {
            this.rawFile = rawFile;
            this.rowFile = rowFile;
            this.onFirstRow = onFirstRow;
        }

        @Override
        public void raw(String row) {
            if (!announced) {
                announced = true;
                if (onFirstRow != null) {
                    onFirstRow.run();
                }
            }
            if (raw == null) {
                raw = open(rawFile);
            }
            write(raw, row);
        }

        @Override
        public void row(String row) {
            if (rows == null) {
                rows = open(rowFile);
            }
            write(rows, row);
        }

        private static BufferedWriter open(Path file) {
            try {
                return Files.newBufferedWriter(file, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
            } catch (Exception e) {
                throw new IllegalStateException("a run output could not be created", e);
            }
        }

        private static void write(BufferedWriter writer, String row) {
            try {
                writer.write(row);
                writer.newLine();
                writer.flush();
            } catch (Exception e) {
                throw new IllegalStateException("a row could not be made durable", e);
            }
        }

        @Override
        public void close() throws Exception {
            if (raw != null) {
                raw.close();
            }
            if (rows != null) {
                rows.close();
            }
        }
    }
}
