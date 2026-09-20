package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * <b>What an approval is worth</b> (Inquiry v3.5).
 *
 * <p>The live approval contract's one-line grant binds to a manifest's {@code approvalId}, {@code runId} and scope.
 * The failure this guards against is not somebody forging an approval — it is a real approval quietly outliving the
 * thing it was given for: a commit moves, a prompt byte changes, a cap is raised, and the grant is still sitting
 * there looking valid.
 *
 * <p>So every bound field is tested by changing it and asserting the run is refused, and the manifest is tested for
 * the one thing it must never contain.
 */
class GoalApprovalTest {

    private static Map<String, String> approvedFields() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("commit", "ccb0c566");
        m.put("tree_clean", "true");
        m.put("runner", CustomerGoalRunner.VERSION);
        m.put("prompt_version", CustomerGoalPrompt.VERSION);
        m.put("system_fp", "aaa");
        m.put("schema_fp", "bbb");
        m.put("input_set_fp", "ccc");
        m.put("request_fp_set", "ddd");
        m.put("model", "gpt-5-2025-08-07");
        m.put("reasoning_effort", "minimal");
        m.put("calls", "13");
        m.put("hard_cap", "13");
        m.put("retry_policy", ApprovalManifest.NO_RETRY);
        m.put("scope", "offline synthetic smoke");
        m.put("transport", "REAL");
        return m;
    }

    private static List<String> refuse(String approvalId, String runId, Map<String, String> actual) {
        return GoalRunGuard.refusals("apr-1", "run-1", approvedFields(), approvalId, runId, actual);
    }

    @Test
    @DisplayName("the approved run proceeds, and only the approved run")
    void theMatchingRunIsAllowed() {
        assertThat(refuse("apr-1", "run-1", approvedFields())).isEmpty();
        assertThat(refuse("apr-2", "run-1", approvedFields())).containsExactly("APPROVAL_ID");
        assertThat(refuse("apr-1", "run-2", approvedFields())).containsExactly("RUN_ID");
        // Identity is checked first and alone: a run carrying the wrong id is not this approval, whatever else is
        // true of it, and reporting the other differences would suggest they were the problem.
        Map<String, String> alsoDifferent = approvedFields();
        alsoDifferent.put("model", "something-else");
        assertThat(refuse("apr-2", "run-1", alsoDifferent)).containsExactly("APPROVAL_ID");
    }

    @Test
    @DisplayName("every bound field revokes the approval when it moves — all fifteen, not a chosen few")
    void anyChangeRevokes() {
        for (String field : GoalRunGuard.BOUND) {
            Map<String, String> moved = approvedFields();
            moved.put(field, moved.get(field) + "-moved");
            assertThat(refuse("apr-1", "run-1", moved)).as("%s did not revoke", field).containsExactly(field);

            Map<String, String> dropped = approvedFields();
            dropped.remove(field);
            assertThat(refuse("apr-1", "run-1", dropped)).as("%s missing did not revoke", field)
                    .containsExactly(field);
        }
        // Named explicitly, because these are the ones an operator would assume are covered.
        assertThat(GoalRunGuard.BOUND).contains("commit", "system_fp", "schema_fp", "input_set_fp",
                "request_fp_set", "model", "reasoning_effort", "hard_cap", "retry_policy", "scope", "transport");
    }

    @Test
    @DisplayName("a manifest that does not carry every bound field cannot be bound to at all")
    void anIncompleteManifestIsNotAnApproval() {
        for (String field : GoalRunGuard.BOUND) {
            Map<String, String> holed = approvedFields();
            holed.remove(field);
            assertThat(GoalRunGuard.missing(holed)).containsExactly(field);
            List<String> refusals = GoalRunGuard.refusals("apr-1", "run-1", holed, "apr-1", "run-1",
                    approvedFields());
            assertThat(refusals).as("%s", field).containsExactly("UNBOUND:" + field);
        }
        assertThat(GoalRunGuard.refusals(null, "run-1", approvedFields(), null, "run-1", approvedFields()))
                .containsExactly("UNIDENTIFIED_APPROVAL");
    }

    @Test
    @DisplayName("a prose manifest cannot authorize a run — it carries none of the fields a run is held to")
    void aDocumentIsNotAnApproval() {
        // What a design document offers: a model, a cap, a description. Everything that identifies THIS run is
        // absent, so there is nothing to compare and the guard says so rather than waving it through.
        Map<String, String> prose = new LinkedHashMap<>();
        prose.put("model", "gpt-5-2025-08-07");
        prose.put("hard_cap", "14");
        prose.put("scope", "the 14 synthetic fixtures");
        assertThat(GoalRunGuard.missing(prose)).hasSize(GoalRunGuard.BOUND.size() - 3);
        assertThat(GoalRunGuard.refusals("apr-1", "run-1", prose, "apr-1", "run-1", approvedFields()))
                .allSatisfy(r -> assertThat(r).startsWith("UNBOUND:"));
        // And a manifest with no ids is refused before its contents are even looked at.
        assertThat(GoalRunGuard.refusals("", "", prose, "", "", prose)).containsExactly("UNIDENTIFIED_APPROVAL");
    }

    @Test
    @DisplayName("the cap is refused before a send, and a negative cap is a broken manifest rather than infinity")
    void theCapIsCheckedBeforehand() {
        GoalRunGuard.checkCap(0, 1);
        GoalRunGuard.checkCap(12, 13);
        assertThatThrownBy(() -> GoalRunGuard.checkCap(13, 13)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("GOAL_MAX_CALLS");
        assertThatThrownBy(() -> GoalRunGuard.checkCap(0, 0)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> GoalRunGuard.checkCap(0, -1)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("GOAL_CAP_INVALID");
    }

    @Test
    @DisplayName("no secret value reaches the manifest, the report or any artifact — only the variable's name")
    void secretsNeverLeaveTheEnvironment() throws Exception {
        String secret = "sk-THIS-IS-THE-SECRET-VALUE-0123456789";
        Map<String, String> env = new LinkedHashMap<>();
        env.put("SELLEROPS_INQUIRY_GOAL_API_KEY", secret);
        env.put("SELLEROPS_INQUIRY_GOAL_ENDPOINT", "https://vendor.invalid/v1/chat/completions");

        var outcome = GoalInterpreterPreflight.prepare(Path.of(".."), env);
        String printed = outcome.report().toPrettyString();
        assertThat(printed).doesNotContain(secret);
        assertThat(printed).doesNotContain(secret.substring(0, 8));
        assertThat(printed).doesNotContain(CustomerGoalPrompt.sha256(secret));
        assertThat(printed).contains("SELLEROPS_INQUIRY_GOAL_API_KEY").contains("PRESENT");
        // The endpoint is configuration rather than a secret, but it is reported the same way for the same reason:
        // the manifest says whether a run could work, not what it would use.
        assertThat(outcome.report().get("environment").get("SELLEROPS_INQUIRY_GOAL_ENDPOINT").asText())
                .isEqualTo("PRESENT");
    }

    @Test
    @DisplayName("a missing variable stops the preflight before transport is possible, and names what is missing")
    void missingEnvironmentStopsBeforeTransport() throws Exception {
        var outcome = GoalInterpreterPreflight.prepare(Path.of(".."), Map.of());
        assertThat(outcome.ready()).isFalse();
        assertThat(outcome.manifest()).as("no manifest is produced with a hole in it").isNull();
        for (String name : GoalInterpreterPreflight.REQUIRED_ENV) {
            assertThat(outcome.blockers()).anySatisfy(b -> assertThat(b).contains(name));
        }
        assertThat(outcome.report().get("verdict").asText()).isEqualTo("BLOCKED");
    }

    @Test
    @DisplayName("a complete preflight produces a manifest whose fingerprints are of the bytes that would be sent")
    void areadyPreflightBindsToRealBytes(@TempDir Path dir) throws Exception {
        // A supplied, complete input set: the READY path exercised by the same code the real preflight runs.
        List<GoalSmokeInputs.Input> inputs = List.of(
                new GoalSmokeInputs.Input("G01", "제품 소재가 뭔가요?", true, null),
                new GoalSmokeInputs.Input("G04", "주문 취소해 주세요", true, null));
        Map<String, String> coverage = new LinkedHashMap<>();
        GoalSmokeInputs.INTENDED.keySet().forEach(k -> coverage.put(k, "covered by a supplied set"));
        var set = new GoalSmokeInputs.Set(inputs, List.of(), coverage);

        Map<String, String> env = Map.of("SELLEROPS_INQUIRY_GOAL_API_KEY", "x",
                "SELLEROPS_INQUIRY_GOAL_ENDPOINT", "https://vendor.invalid/v1");
        // A real, clean checkout — the clean-tree gate is exercised rather than stubbed out, which matters because
        // running this against THIS worktree is how the gate was first seen working: it refused, correctly, because
        // the harness being written was itself uncommitted.
        var outcome = GoalInterpreterPreflight.prepare(cleanRepo(dir.resolve("repo")), env, set);
        assertThat(outcome.blockers()).isEmpty();
        ApprovalManifest manifest = outcome.manifest();
        assertThat(manifest.approvalId()).startsWith("apr-");
        assertThat(manifest.calls()).isEqualTo(2);
        assertThat(manifest.hardCap()).as("the cap is the call count: this manifest authorizes exactly these")
                .isEqualTo(manifest.calls());
        assertThat(manifest.realCustomerText()).isFalse();
        assertThat(GoalRunGuard.missing(manifest.bound())).isEmpty();

        // The fingerprints identify the real request bytes.
        var runner = new CustomerGoalRunner(GoalInterpreterPreflight.MODEL,
                GoalInterpreterPreflight.REASONING_EFFORT, (u, h, b) -> {
                    throw new AssertionError("no send");
                }, null);
        var requests = runner.prepare(inputs.stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList());
        assertThat(manifest.requestFps()).isEqualTo(requests.stream()
                .map(CustomerGoalRunner.Request::requestFp).toList());
        assertThat(manifest.systemFp()).isEqualTo(CustomerGoalPrompt.sha256(CustomerGoalPrompt.system()));

        // It round-trips, is written once, and is never rewritten in place.
        Path out = dir.resolve("APPROVAL.json");
        manifest.write(out);
        assertThat(ApprovalManifest.read(out).bound()).isEqualTo(manifest.bound());
        assertThatThrownBy(() -> manifest.write(out)).isInstanceOf(java.nio.file.FileAlreadyExistsException.class);
        assertThat(Files.readString(out)).contains("\"revoked_by_any_change_to\"").contains("EXTRAPOLATED");
    }

    /** A committed checkout carrying the one file the preflight reads, so "clean tree" is a fact and not a flag. */
    private static Path cleanRepo(Path root) throws Exception {
        Path fixture = root.resolve("contracts/inquiry-goal/v1/synthetic");
        Files.createDirectories(fixture);
        Files.copy(Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic", "goal-scenarios.jsonl"),
                fixture.resolve("goal-scenarios.jsonl"));
        for (String[] command : new String[][] {
                {"git", "init", "-q"},
                {"git", "config", "user.email", "harness@example.invalid"},
                {"git", "config", "user.name", "harness"},
                {"git", "add", "-A"},
                {"git", "commit", "-q", "-m", "fixture"}}) {
            Process p = new ProcessBuilder(command).directory(root.toFile()).redirectErrorStream(true).start();
            assertThat(p.waitFor()).as("%s", String.join(" ", command)).isZero();
        }
        return root;
    }

    @Test
    @DisplayName("the declared side effects are all zero, and they are declared rather than assumed")
    void sideEffectsAreWrittenDown() {
        Map<String, Object> effects = ApprovalManifest.sideEffects();
        List<String> zeroes = new ArrayList<>(effects.keySet());
        zeroes.remove("raw_before_scoring");
        for (String k : zeroes) {
            assertThat(effects.get(k)).as("%s", k).isEqualTo(0);
        }
        assertThat(effects.get("raw_before_scoring")).isEqualTo(true);
        assertThat(effects).containsKeys("marketplace_calls", "marketplace_writes", "db_writes", "migrations",
                "production_cases_changed", "external_writes", "judge_calls", "draft_calls", "retrieval_calls");
    }
}
