package com.sellerops.inquiry.goal;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.JdkAgentLlmTransport;
import java.io.BufferedWriter;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <b>The one way to actually run the smoke</b> (Inquiry v3.5 §23.9).
 *
 * <p>It exists because the package before it built modes and a guard and no way to use them: the binding an operator
 * grants against was tested nine ways and wired into nothing, so "running with the approval" would have meant
 * running <i>beside</i> it. This is the entrypoint, and it is deliberately small — it reads the approved manifest
 * off disk, assembles the frozen inputs, hands the real transport to {@link CustomerGoalRunner#send}, and streams
 * what comes back. <b>Every decision about whether the run may happen is the runner's, not this class's</b>, so
 * there is no second place to get it wrong.
 *
 * <p><b>Test tree, on purpose.</b> The interpreter still has no production caller, and a sender in {@code main}
 * would quietly make that untrue. Nothing here is reachable from the application.
 *
 * <h2>Running it</h2>
 *
 * <pre>
 *   export SELLEROPS_INQUIRY_GOAL_API_KEY=...        # in the operator's own shell, never in the repository
 *   export SELLEROPS_INQUIRY_GOAL_ENDPOINT=https://...
 *   java -cp &lt;test runtime classpath&gt; com.sellerops.inquiry.goal.GoalRunLauncher \
 *        --approval  ~/.sellerops/eval-store/runs/&lt;run-id&gt;/APPROVAL.json \
 *        --granted-approval apr-... \
 *        --granted-run      &lt;run-id&gt; \
 *        --out       &lt;a new directory&gt;
 * </pre>
 *
 * <p>The two granted ids are typed by the operator and compared against the file. Comparing the file to itself
 * would prove nothing; the thing worth catching is a launcher aimed at a manifest the operator never read.
 */
public final class GoalRunLauncher {

    /** The credential's variable. Read from the process environment, handed to the transport, never anywhere else. */
    public static final String CREDENTIAL_ENV = "SELLEROPS_INQUIRY_GOAL_API_KEY";
    public static final String ENDPOINT_ENV = "SELLEROPS_INQUIRY_GOAL_ENDPOINT";

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
            int calls = launch(args, System.getenv(), new JdkAgentLlmTransport());
            System.out.println("RUN complete — calls " + calls + ", rows under " + args.out());
            System.out.println("next: node tools/eval-store/store.mjs run-put " + args.grantedRunId()
                    + " " + args.out());
        } catch (CustomerGoalRunner.Refused refused) {
            // Reasons only. A refusal names the field that moved and never carries a value.
            System.out.println("RUN refused — 0 sends");
            refused.reasons().forEach(r -> System.out.println("  - " + r));
            System.exit(3);
        }
    }

    /**
     * @param env       the process environment. <b>Nothing repo-relative is ever read</b> — no {@code .env}, no
     *                  {@code .env.local}, not in this worktree and not in any other. A harness that goes looking
     *                  for credentials is a harness that can find the wrong ones.
     * @param transport the real one from {@link #main}; a fake one in tests, which is the only place a fake belongs
     * @return how many calls were sent
     */
    public static int launch(Args args, Map<String, String> env, AgentLlmTransport transport) throws Exception {
        ApprovalManifest approval = ApprovalManifest.read(args.approval());

        String endpoint = env.get(ENDPOINT_ENV);
        if (endpoint == null || endpoint.isBlank()) {
            throw new CustomerGoalRunner.Refused(List.of("ENV_MISSING:" + ENDPOINT_ENV));
        }
        // The credential is moved from the environment into the header and is not looked at on the way past. The
        // runner refuses an absent one before it sends; nothing here, or there, reads its value.
        String credential = env.get(CREDENTIAL_ENV);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        if (credential != null && !credential.isBlank()) {
            headers.put(CustomerGoalRunner.AUTHORIZATION, "Bearer " + credential);
        }

        GoalSmokeInputs.Set set = GoalSmokeInputs.assemble(
                args.repoRoot().resolve("contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl"),
                GoalInterpreterPreflight.storeRoot(env));
        List<CustomerGoalRunner.Input> inputs = set.usable().stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList();

        Files.createDirectories(args.out());
        Path rawFile = args.out().resolve("raw.jsonl");
        Path rowFile = args.out().resolve("rows.jsonl");
        CustomerGoalRunner runner = new CustomerGoalRunner(approval.model(), approval.reasoningEffort(),
                transport, URI.create(endpoint), headers);
        try (Streaming sink = new Streaming(rawFile, rowFile)) {
            return runner.send(approval, new CustomerGoalRunner.World(args.repoRoot(),
                    args.grantedApprovalId(), args.grantedRunId(), rowFile), inputs, sink).calls();
        }
    }

    /**
     * Rows reach the disk as the run progresses, raw first and flushed immediately.
     *
     * <p>Buffering a run and writing it at the end means a process that dies halfway recorded nothing, and a vendor
     * answer cannot be produced a second time. Both files are {@code CREATE_NEW}, and both are opened <b>on the
     * first row</b> — so a refused run leaves no files behind at all, and the runner's own "this output already
     * exists" check is not tripped by the writer that was going to serve it.
     */
    static final class Streaming implements CustomerGoalRunner.Sink, AutoCloseable {
        private final Path rawFile;
        private final Path rowFile;
        private BufferedWriter raw;
        private BufferedWriter rows;

        Streaming(Path rawFile, Path rowFile) {
            this.rawFile = rawFile;
            this.rowFile = rowFile;
        }

        @Override
        public void raw(String row) {
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
