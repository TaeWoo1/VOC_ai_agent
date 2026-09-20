package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * <b>A run that was not approved does not happen, and "does not happen" is a number</b> (Inquiry v3.5).
 *
 * <p>Every test here counts sends. The failure being guarded against is not a forged approval — it is a real one
 * quietly outliving the thing it was given for, and the shape of that failure is <b>a run that starts</b>. So each
 * case moves exactly one bound field and asserts the transport was asked for nothing at all: not a partial run, not
 * one call and then a stop.
 *
 * <p>Manifests come from {@link GoalInterpreterPreflight} against a real committed checkout. Nothing here builds an
 * approval by hand, because a hand-built one agrees with the test that wrote it.
 */
class GoalRunLauncherTest {

    private static Path out(Path dir) {
        return dir.resolve("rows.jsonl");
    }

    /** Move one bound field on the approval and assert the send count stays at zero. */
    private static void refused(GoalRunFixtures.Approved approved, ApprovalManifest manifest, Path outFile,
                                String expected) {
        var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        var runner = GoalRunFixtures.runner(transport, GoalRunFixtures.credential());
        var world = new CustomerGoalRunner.World(approved.repoRoot(), manifest.approvalId(), manifest.runId(),
                outFile);
        assertThatThrownBy(() -> runner.send(manifest, world, approved.inputs(), new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons()).contains(expected));
        assertThat(transport.sends.get()).as("%s: the run started anyway", expected).isZero();
    }

    @Test
    @DisplayName("RUN cannot be entered without the approved manifest — there is no other way in")
    void sendRequiresAManifest() throws Exception {
        // By type: the only method that reaches the transport takes an ApprovalManifest as its first parameter.
        var send = CustomerGoalRunner.class.getMethod("send", ApprovalManifest.class,
                CustomerGoalRunner.World.class, List.class, CustomerGoalRunner.Sink.class);
        assertThat(send.getParameterTypes()[0]).isEqualTo(ApprovalManifest.class);
        for (var method : CustomerGoalRunner.class.getMethods()) {
            if (method.getDeclaringClass() != CustomerGoalRunner.class) {
                continue;
            }
            boolean takesManifest = List.of(method.getParameterTypes()).contains(ApprovalManifest.class);
            assertThat(method.getName()).as("%s can send and takes no manifest", method.getName())
                    .satisfiesAnyOf(name -> assertThat(takesManifest).isTrue(),
                            name -> assertThat(name).isIn("prepare", "dryRun", "replay", "inputSetFp",
                                    "requestFpSet", "write", "sha"));
        }
        // By source: the transport is touched in exactly one place, and the guard is asked above it.
        String source = Files.readString(Path.of("src", "test", "java", "com", "sellerops", "inquiry", "goal",
                "CustomerGoalRunner.java"));
        assertThat(source.split("transport\\.post\\(", -1).length - 1).as("more than one way out").isEqualTo(1);
        assertThat(source.indexOf("GoalRunGuard.refusals(")).as("the guard is not consulted at all")
                .isGreaterThan(0).isLessThan(source.indexOf("transport.post("));

        // And a null manifest is refused rather than treated as "no conditions".
        var runner = GoalRunFixtures.runner(new GoalRunFixtures.Counting(""), GoalRunFixtures.credential());
        assertThatThrownBy(() -> runner.send(null, null, List.of(), new GoalRunFixtures.Recording()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a matching approval enters RUN, sends exactly what was approved, and stops there")
    void anApprovedRunProceeds(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        var runner = GoalRunFixtures.runner(transport, GoalRunFixtures.credential());
        var sink = new GoalRunFixtures.Recording();
        var result = runner.send(approved.manifest(), approved.world(out(dir)), approved.inputs(), sink);

        assertThat(transport.sends.get()).isEqualTo(approved.manifest().calls()).isEqualTo(2);
        assertThat(result.calls()).isEqualTo(2);
        assertThat(sink.raw).hasSize(2);
        assertThat(sink.rows).hasSize(2);
        // Raw before scoring, through the real path: every raw precedes its own row.
        assertThat(sink.order).containsExactly("raw", "row", "raw", "row");
    }

    @Test
    @DisplayName("the wrong approval id, and the wrong run id, each stop the run before it starts")
    void identityIsCheckedFirst(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        for (String[] granted : new String[][] {{"apr-someone-elses", approved.manifest().runId(), "APPROVAL_ID"},
                {approved.manifest().approvalId(), "run-someone-elses", "RUN_ID"}}) {
            var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
            var runner = GoalRunFixtures.runner(transport, GoalRunFixtures.credential());
            var world = new CustomerGoalRunner.World(approved.repoRoot(), granted[0], granted[1], out(dir));
            assertThatThrownBy(() -> runner.send(approved.manifest(), world, approved.inputs(),
                    new GoalRunFixtures.Recording()))
                    .isInstanceOf(CustomerGoalRunner.Refused.class)
                    .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons())
                            .containsExactly(granted[2]));
            assertThat(transport.sends.get()).isZero();
        }
    }

    @Test
    @DisplayName("every bound field, moved one at a time, leaves the send count at zero")
    void everyBoundFieldRefuses(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        Map<String, String> moves = new java.util.LinkedHashMap<>();
        moves.put("commit", "0000000000000000000000000000000000000000");
        moves.put("tree_clean", "false");
        moves.put("runner", "customer-goal-runner/v0");
        moves.put("prompt_version", "customer-goal-interpreter/v0");
        moves.put("system_fp", "a-different-instruction");
        moves.put("schema_fp", "a-different-schema");
        moves.put("input_set_fp", "a-different-corpus");
        moves.put("request_fp_set", "a-different-request");
        moves.put("model", "some-other-model");
        moves.put("reasoning_effort", "high");
        moves.put("calls", "99");
        moves.put("hard_cap", "99");
        moves.put("retry_policy", "retry three times");
        moves.put("scope", "something else entirely");
        // A manifest prepared for a rehearsal, handed to a run holding a real transport. This is the crossing the
        // fifteenth field exists to stop, and it refuses like any other moved field rather than by a special case.
        moves.put("transport", GoalTransport.Mode.FAKE.name());
        assertThat(moves.keySet()).as("a bound field with no test is a rule nobody checks")
                .containsExactlyElementsOf(GoalRunGuard.BOUND);
        for (var move : moves.entrySet()) {
            refused(approved, GoalRunFixtures.moved(approved.manifest(), move.getKey(), move.getValue()),
                    dir.resolve(move.getKey() + ".jsonl"), move.getKey());
        }
    }

    @Test
    @DisplayName("a commit made after the approval, and a dirty tree, are read from the world and not the manifest")
    void theWorldIsReReadAtSendTime(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));

        // The approval was prepared at the previous commit; committing again moves the world under it.
        Files.writeString(approved.repoRoot().resolve("NOTE.md"), "anything\n");
        GoalRunFixtures.commit(approved.repoRoot());
        refused(approved, approved.manifest(), dir.resolve("moved.jsonl"), "commit");

        // And an uncommitted change makes the run unattributable, whatever the manifest remembers.
        var atHead = GoalRunFixtures.approved(dir.resolve("repo2"));
        Files.writeString(atHead.repoRoot().resolve("DIRTY.md"), "uncommitted\n");
        refused(atHead, atHead.manifest(), dir.resolve("dirty.jsonl"), "tree_clean");
    }

    @Test
    @DisplayName("handing the runner different inputs than were approved refuses before the first send")
    void theInputsAreTheOnesApproved(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        List<CustomerGoalRunner.Input> different = List.of(
                new CustomerGoalRunner.Input("G01", "완전히 다른 질문입니다"),
                approved.inputs().get(1));
        var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        var runner = GoalRunFixtures.runner(transport, GoalRunFixtures.credential());
        assertThatThrownBy(() -> runner.send(approved.manifest(), approved.world(out(dir)), different,
                new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons())
                        .contains("input_set_fp", "request_fp_set"));
        assertThat(transport.sends.get()).isZero();

        // More inputs than approved moves the count as well, and is refused for that too.
        List<CustomerGoalRunner.Input> more = new ArrayList<>(approved.inputs());
        more.add(new CustomerGoalRunner.Input("G05", "지금 주문 취소가 가능한가요?"));
        assertThatThrownBy(() -> runner.send(approved.manifest(), approved.world(dir.resolve("more.jsonl")), more,
                new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons()).contains("calls"));
        assertThat(transport.sends.get()).isZero();
    }

    @Test
    @DisplayName("no credential, no run — and presence is all that is ever checked")
    void aMissingCredentialStopsTheRun(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        for (Map<String, String> headers : List.of(Map.<String, String>of(),
                Map.of(CustomerGoalRunner.AUTHORIZATION, "   "))) {
            var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
            var runner = GoalRunFixtures.runner(transport, headers);
            assertThatThrownBy(() -> runner.send(approved.manifest(), approved.world(out(dir)), approved.inputs(),
                    new GoalRunFixtures.Recording()))
                    .isInstanceOf(CustomerGoalRunner.Refused.class)
                    .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons())
                            .anySatisfy(r -> assertThat(r).startsWith("CREDENTIAL_MISSING")));
            assertThat(transport.sends.get()).isZero();
        }
    }

    @Test
    @DisplayName("an output that already exists stops the run — a recorded answer is never overwritten")
    void outputCollisionStopsTheRun(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        Path taken = dir.resolve("taken.jsonl");
        Files.writeString(taken, "{\"an\":\"earlier run\"}\n");
        var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        var runner = GoalRunFixtures.runner(transport, GoalRunFixtures.credential());
        assertThatThrownBy(() -> runner.send(approved.manifest(), approved.world(taken), approved.inputs(),
                new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons())
                        .anySatisfy(r -> assertThat(r).startsWith("OUTPUT_EXISTS")));
        assertThat(transport.sends.get()).isZero();
        assertThat(Files.readString(taken)).isEqualTo("{\"an\":\"earlier run\"}\n");
    }

    @Test
    @DisplayName("a refusal names what moved and never a value that could be a secret")
    void refusalsCarryNoSecrets(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        var runner = GoalRunFixtures.runner(new GoalRunFixtures.Counting(""), GoalRunFixtures.credential());
        var moved = GoalRunFixtures.moved(approved.manifest(), "model", "some-other-model");
        var world = new CustomerGoalRunner.World(approved.repoRoot(), moved.approvalId(), moved.runId(),
                out(dir));
        try {
            runner.send(moved, world, approved.inputs(), new GoalRunFixtures.Recording());
        } catch (CustomerGoalRunner.Refused refused) {
            assertThat(refused.reasons()).containsExactly("model");
            assertThat(refused.getMessage()).doesNotContain(GoalRunFixtures.FAKE_CREDENTIAL)
                    .doesNotContain("FAKE-TEST-CREDENTIAL");
        }
    }

    @Test
    @DisplayName("the cap still holds after the guard has agreed — defence in depth, not instead of")
    void theCapIsStillEnforcedInsideTheRun(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        // An approval whose cap is below its own call count: the guard agrees field by field, and the run still
        // stops at the cap rather than finishing what the count promised.
        var lowCap = GoalRunFixtures.moved(approved.manifest(), "hard_cap", "1");
        var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        var runner = GoalRunFixtures.runner(transport, GoalRunFixtures.credential());
        var world = new CustomerGoalRunner.World(approved.repoRoot(), lowCap.approvalId(), lowCap.runId(),
                out(dir));
        assertThatThrownBy(() -> runner.send(lowCap, world, approved.inputs(), new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class);
        assertThat(transport.sends.get()).as("the guard caught it first, so the cap never had to").isZero();
    }


    // --- the launcher itself ------------------------------------------------------------------------------

    private static GoalRunLauncher.Args argsFor(GoalRunFixtures.Approved approved, Path dir) throws Exception {
        Path manifest = dir.resolve("APPROVAL.json");
        approved.manifest().write(manifest);
        return new GoalRunLauncher.Args(manifest, approved.manifest().approvalId(), approved.manifest().runId(),
                dir.resolve("out"), approved.repoRoot());
    }

    @Test
    @DisplayName("the launcher reads the manifest off disk and runs exactly it")
    void theLauncherRunsTheApprovedManifest(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approvedFromFixture(dir.resolve("repo"));
        var args = argsFor(approved, dir);
        var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        Map<String, String> env = GoalRunFixtures.fixtureEnv(approved.repoRoot());

        var report = GoalRunLauncher.launch(args, env, transport);
        int calls = report.get("calls_attempted").asInt();
        assertThat(calls).isEqualTo(approved.manifest().calls());
        assertThat(transport.sends.get()).isEqualTo(calls);
        assertThat(report.get("status").asText()).isEqualTo("COMPLETE");
        assertThat(report.get("run_incomplete").asBoolean()).isFalse();

        // Rows are on disk, raw beside them, and the credential is in neither.
        List<String> raw = Files.readAllLines(args.out().resolve("raw.jsonl"));
        List<String> rows = Files.readAllLines(args.out().resolve("rows.jsonl"));
        assertThat(raw).hasSize(calls);
        assertThat(rows).hasSize(calls);
        assertThat(String.join("\n", raw) + String.join("\n", rows))
                .doesNotContain("FAKE-TEST-CREDENTIAL").doesNotContain("Bearer");
        assertThat(raw.get(0)).contains("\"raw\"");

        // Both run-state markers, in the order that makes an interrupted run distinguishable from a finished one.
        assertThat(args.out().resolve(GoalRunLauncher.STARTED)).exists();
        assertThat(args.out().resolve(GoalRunLauncher.COMPLETE)).exists();
        assertThat(Files.readString(args.out().resolve(GoalRunLauncher.STARTED))).contains("CONSUMED");

        // The store refused the temporary root, and the observation did not care. That is the property under test,
        // not a gap in it: a finalization that fails leaves the vendor's answers exactly where they landed.
        assertThat(report.get("finalization").get("run-put").asText()).startsWith("FAILED");
        assertThat(Files.readAllLines(args.out().resolve("raw.jsonl"))).hasSize(calls);
        assertThat(report.toString()).doesNotContain("FAKE-TEST-CREDENTIAL");
    }

    @Test
    @DisplayName("no endpoint and no credential each stop the launcher before anything is sent or written")
    void theLauncherRefusesAnIncompleteEnvironment(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approvedFromFixture(dir.resolve("repo"));
        var args = argsFor(approved, dir);
        var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        Map<String, String> store = Map.of("SELLEROPS_EVAL_CACHE",
                GoalRunFixtures.fixtureEnv(approved.repoRoot()).get("SELLEROPS_EVAL_CACHE"));

        assertThatThrownBy(() -> GoalRunLauncher.launch(args, store, transport))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons())
                        .anySatisfy(r -> assertThat(r).contains(GoalRunLauncher.ENDPOINT_ENV)));
        assertThat(transport.sends.get()).isZero();

        assertThatThrownBy(() -> GoalRunLauncher.launch(args,
                Map.of(GoalRunLauncher.ENDPOINT_ENV, "https://vendor.invalid/v1",
                        "SELLEROPS_EVAL_CACHE", store.get("SELLEROPS_EVAL_CACHE")), transport))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons())
                        .anySatisfy(r -> assertThat(r).startsWith("CREDENTIAL_MISSING")));
        assertThat(transport.sends.get()).isZero();

        // A refused launch leaves nothing behind: the writers open on the first row, and there was no first row.
        assertThat(Files.exists(args.out().resolve("raw.jsonl"))).isFalse();
        assertThat(Files.exists(args.out().resolve("rows.jsonl"))).isFalse();
    }

    @Test
    @DisplayName("the launcher reads the environment and nothing repo-relative — no .env of any kind")
    void theLauncherNeverLooksForSecretsOnDisk() throws Exception {
        String source = Files.readString(Path.of("src", "test", "java", "com", "sellerops", "inquiry", "goal",
                "GoalRunLauncher.java"));
        // Comments in this file discuss .env by name, so the check is on what the CODE does: the only credential
        // read is from the map passed in, which main() fills from System.getenv() and nowhere else.
        String code = source.lines().filter(l -> !l.trim().startsWith("*") && !l.trim().startsWith("//"))
                .reduce("", (a, b) -> a + "\n" + b);
        assertThat(code).doesNotContain(".env").doesNotContain("env.local").doesNotContain("dotenv");
        assertThat(code).contains("System.getenv()");
        assertThat(code.split("System\\.getenv\\(", -1).length - 1).as("one source of environment").isEqualTo(1);
    }

    @Test
    @DisplayName("a failure to score cannot erase the observation that was already durable")
    void rawSurvivesAScoringFailure(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        var transport = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        var runner = GoalRunFixtures.runner(transport, GoalRunFixtures.credential());
        List<String> durable = new ArrayList<>();
        assertThatThrownBy(() -> runner.send(approved.manifest(), approved.world(out(dir)), approved.inputs(),
                new CustomerGoalRunner.Sink() {
                    @Override
                    public void raw(String row) {
                        durable.add(row);
                    }

                    @Override
                    public void row(String row) {
                        throw new IllegalStateException("scoring blew up");
                    }
                })).hasMessageContaining("scoring blew up");
        assertThat(durable).as("the vendor answered and the answer survived everything after it").hasSize(1);
        assertThat(durable.get(0)).contains("\"raw\"").contains("\"request_fp\"");
    }
}
