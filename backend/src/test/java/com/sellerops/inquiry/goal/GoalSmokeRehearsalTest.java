package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * <b>The dress rehearsal</b> (Inquiry v3.5 §23.10) — the operator's command, run for real, with only the vendor
 * replaced.
 *
 * <p>Every other test in this package asserts a property of a method. This one starts a <b>separate JVM</b> at the
 * same entrypoint the Gradle task starts, hands it a process environment it controls, and reads what comes back: the
 * exit code, the report on stdout, and the files left on disk. That distinction is the whole point. A unit test can
 * prove a guard refuses; only a subprocess can prove that the <i>command an operator types</i> refuses — that the
 * environment arrives, that {@code main} wires the pieces together in the order the contract requires, and that a
 * refusal leaves an empty directory rather than a half-written run.
 *
 * <p><b>Zero network.</b> The transport is {@link GoalTransport.Mode#FAKE}, whose endpoint is a scheme no client
 * dials, and the real endpoint variable is deliberately absent from every environment below. Nothing here can reach
 * a vendor even if it tried.
 *
 * <h2>What the fake is allowed to prove, and what it is not</h2>
 *
 * <p>It proves <b>execution</b>: fourteen sends, the cap, row ordering, raw before derived, parsing, contract
 * validation, the scorer, the store, verification, the report. It proves nothing whatever about a model, and the run
 * report it produces says so in as many words — an artifact that looked like a measurement is how a harness number
 * becomes a quoted score.
 */
class GoalSmokeRehearsalTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Distinctive, obviously not a key, and long enough that a partial leak is still findable. */
    private static final String CREDENTIAL = "REHEARSAL-KEY-9d3f1a27c5b84e60-not-a-real-credential";

    // --- the fixture --------------------------------------------------------------------------------------

    /** A committed checkout, a cache holding the inputs, a store that will accept a run, and a manifest. */
    private record Fixture(Path repo, Path cache, Path store, Path manifestFile, ApprovalManifest manifest,
                           Path out) {

        Map<String, String> env() {
            Map<String, String> env = new LinkedHashMap<>();
            env.put("SELLEROPS_EVAL_CACHE", cache.toString());
            env.put("SELLEROPS_EVAL_STORE", store.toString());
            env.put(GoalRunLauncher.CREDENTIAL_ENV, CREDENTIAL);
            env.put(GoalTransport.MODE_ENV, "FAKE");
            // The real endpoint is NEVER set in this file. A rehearsal has no endpoint to configure.
            return env;
        }

        List<String> args() {
            return List.of("--approval", manifestFile.toString(),
                    "--granted-approval", manifest.approvalId(),
                    "--granted-run", manifest.runId(),
                    "--out", out.toString(),
                    "--repo", repo.toString());
        }
    }

    private static Fixture fixture(Path dir) throws Exception {
        Path repo = Files.createDirectories(dir.resolve("repo"));
        Path fixtureDir = Files.createDirectories(repo.resolve("contracts/inquiry-goal/v1/synthetic"));
        Files.copy(Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic", "goal-scenarios.jsonl"),
                fixtureDir.resolve("goal-scenarios.jsonl"));
        // The finalization steps shell out to this repository's own tools, by the same relative paths an operator
        // would use. A symlink rather than a copy: the scripts under test must be the committed ones.
        Files.createSymbolicLink(repo.resolve("tools"), Path.of("..", "tools").toAbsolutePath().normalize());
        // So that a test can drop a .env beside the run WITHOUT moving the commit. Without this, planting one
        // would revoke the approval and the refusal would name the commit — which proves nothing about dotenv.
        Files.writeString(repo.resolve(".gitignore"), ".env\n.env.local\nout/\n");
        GoalRunFixtures.commit(repo);

        Path cache = Files.createDirectories(dir.resolve("cache"));
        Path capture = cache.resolve(GoalSmokeInputs.CAPTURE);
        Files.createDirectories(capture.getParent());
        Files.writeString(capture, "{\"q\":\"" + GoalSmokeInputs.NO_GOAL_CASE
                + "\",\"question\":\"합성 스탠드인 문장입니다. 실제 고객 문장이 아닙니다.\"}\n");
        // The frozen gold, if this machine has it restored. Real eval data lives outside git by design, so a
        // machine without it exercises the scorer's honest "I cannot find my gold" branch instead.
        Path realGold = Path.of(System.getProperty("user.home"), ".sellerops", "eval-store",
                "inquiry-customer-goal", "v3", "goals.jsonl");
        if (Files.exists(realGold)) {
            Path gold = cache.resolve(GoalRunFinalizer.GOLD);
            Files.createDirectories(gold.getParent());
            Files.copy(realGold, gold);
        }

        // Not a temp directory: the store refuses those by its own rule, and this fixture wants the ACCEPTING
        // path. Removed again in every test that creates it.
        Path store = Path.of(System.getProperty("user.home"), ".cache",
                "sellerops-goal-rehearsal", UUID.randomUUID().toString());
        Files.createDirectories(store);

        Map<String, String> prepareEnv = new LinkedHashMap<>();
        prepareEnv.put("SELLEROPS_EVAL_CACHE", cache.toString());
        prepareEnv.put(GoalRunLauncher.CREDENTIAL_ENV, CREDENTIAL);
        prepareEnv.put(GoalTransport.MODE_ENV, "FAKE");
        var outcome = GoalInterpreterPreflight.prepare(repo, prepareEnv, null);
        assertThat(outcome.manifest()).as("the rehearsal preflight was blocked: %s", outcome.blockers()).isNotNull();

        Path manifestFile = dir.resolve("APPROVAL.json");
        outcome.manifest().write(manifestFile);
        return new Fixture(repo, cache, store, manifestFile, outcome.manifest(), dir.resolve("out"));
    }

    private static void cleanUp(Fixture fixture) throws IOException {
        if (fixture == null || !Files.exists(fixture.store())) {
            return;
        }
        try (var paths = Files.walk(fixture.store())) {
            for (Path p : paths.sorted(Comparator.reverseOrder()).toList()) {
                p.toFile().setWritable(true);
                Files.deleteIfExists(p);
            }
        }
    }

    // --- the subprocess -----------------------------------------------------------------------------------

    private record Ran(int exit, String stdout, String stderr) {
        JsonNode report() {
            try {
                int start = stdout.indexOf('{');
                return start < 0 ? JSON.createObjectNode() : JSON.readTree(stdout.substring(start));
            } catch (Exception e) {
                throw new IllegalStateException("the launcher printed something that is not a report:\n" + stdout, e);
            }
        }

        String everythingItSaid() {
            return stdout + "\n" + stderr;
        }
    }

    /**
     * Start the launcher in its own JVM with a <b>cleared</b> environment, so what it reads is exactly what this
     * test put there — the strongest available form of "it reads the process environment and nothing else".
     */
    private static Ran launch(Map<String, String> env, List<String> args) throws Exception {
        List<String> command = new ArrayList<>(List.of(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"),
                GoalRunLauncher.class.getName()));
        command.addAll(args);

        ProcessBuilder builder = new ProcessBuilder(command);
        builder.environment().clear();
        // Only what a JVM and node need to exist at all, plus what this run is being given on purpose.
        builder.environment().put("PATH", System.getenv("PATH") == null ? "/usr/bin:/bin" : System.getenv("PATH"));
        builder.environment().put("HOME", System.getProperty("user.home"));
        builder.environment().putAll(env);

        Process process = builder.start();
        String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
        return new Ran(process.waitFor(), stdout, stderr);
    }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** No form of the credential — whole, either end, or digested — appears anywhere this run wrote or said. */
    private static void assertNoCredentialAnywhere(Ran ran, Path out) throws Exception {
        StringBuilder everything = new StringBuilder(ran.everythingItSaid());
        if (Files.isDirectory(out)) {
            try (var paths = Files.walk(out)) {
                for (Path p : paths.filter(Files::isRegularFile).toList()) {
                    everything.append('\n').append(Files.readString(p));
                }
            }
        }
        String text = everything.toString();
        assertThat(text).as("the whole value").doesNotContain(CREDENTIAL);
        assertThat(text).as("a leading fragment").doesNotContain(CREDENTIAL.substring(0, 16));
        assertThat(text).as("a trailing fragment")
                .doesNotContain(CREDENTIAL.substring(CREDENTIAL.length() - 16));
        assertThat(text).as("a hash is a secret with one extra step").doesNotContain(sha256(CREDENTIAL));
        assertThat(text).as("nor the bearer header it was folded into").doesNotContain("Bearer ");
    }

    private static void assertNothingWasWritten(Path out) {
        assertThat(Files.exists(out.resolve("raw.jsonl"))).as("raw").isFalse();
        assertThat(Files.exists(out.resolve("rows.jsonl"))).as("rows").isFalse();
        assertThat(Files.exists(out.resolve(GoalRunLauncher.STARTED))).as("the approval was not consumed").isFalse();
    }

    // --- the positive rehearsal ---------------------------------------------------------------------------

    @Test
    @DisplayName("one command: fourteen fake sends, raw before derived, scored, stored, verified, reported")
    void theWholePathRunsFromOneCommand(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);
            assertThat(fixture.manifest().calls()).as("the frozen corpus is fourteen inputs").isEqualTo(14);
            assertThat(fixture.manifest().transport()).isEqualTo("FAKE");

            Ran ran = launch(fixture.env(), fixture.args());
            assertThat(ran.exit()).as("stderr was:\n%s", ran.stderr()).isZero();

            JsonNode report = ran.report();
            assertThat(report.get("status").asText()).isEqualTo("COMPLETE");
            assertThat(report.get("calls_attempted").asInt()).isEqualTo(14);
            assertThat(report.get("calls_completed").asInt()).isEqualTo(14);
            assertThat(report.get("transport").asText()).isEqualTo("FAKE");
            assertThat(report.get("hard_cap").asInt()).isEqualTo(14);
            assertThat(report.get("run_incomplete").asBoolean()).isFalse();
            assertThat(report.get("metrics_meaning").asText())
                    .as("a rehearsal must never read as a model result")
                    .contains("EXECUTION REHEARSAL ONLY").contains("NOTHING about a model");

            // Exactly fourteen observations, and exactly fourteen derived rows beside them.
            List<String> raw = Files.readAllLines(fixture.out().resolve("raw.jsonl"));
            List<String> rows = Files.readAllLines(fixture.out().resolve("rows.jsonl"));
            assertThat(raw).hasSize(14);
            assertThat(rows).hasSize(14);

            // Ordering: every row is in the same order as its observation, and each is the id the corpus named.
            List<String> rawIds = raw.stream().map(GoalSmokeRehearsalTest::idOf).toList();
            assertThat(rawIds).isEqualTo(rows.stream().map(GoalSmokeRehearsalTest::idOf).toList());
            assertThat(rawIds).containsExactlyElementsOf(fixture.manifest().inputIds());

            // The fake's answer went through the real parser and the real contract, not around them.
            for (String row : rows) {
                JsonNode node = JSON.readTree(row);
                assertThat(node.get("failure").isNull()).as("%s", node.get("id")).isTrue();
                assertThat(node.get("valid").asBoolean()).isTrue();
                assertThat(node.get("goals")).hasSize(1);
                assertThat(node.get("transport").asText()).isEqualTo("FAKE");
            }
            // Raw carries the observation and nothing derived from it.
            assertThat(JSON.readTree(raw.get(0)).has("goals")).as("raw is the observation, not a reading").isFalse();

            // Both run-state markers, which is what tells a later reader this run finished.
            assertThat(fixture.out().resolve(GoalRunLauncher.STARTED)).exists();
            assertThat(fixture.out().resolve(GoalRunLauncher.COMPLETE)).exists();

            // Finalization: scoring (when this machine has the gold), storage, verification — all from the one
            // command, with nothing left for an operator to remember.
            JsonNode steps = report.get("finalization");
            assertThat(steps.get("run-put").asText()).startsWith("ok");
            assertThat(steps.get("run-verify").asText()).startsWith("ok");
            assertThat(report.get("run_verify").asText()).isEqualTo("ok");
            if (Files.exists(fixture.cache().resolve(GoalRunFinalizer.GOLD))) {
                assertThat(steps.get("score").asText()).startsWith("ok");
                String scored = Files.readString(fixture.out().resolve("score.json"));
                JsonNode score = JSON.readTree(scored);
                assertThat(score.get("provenance")).as("score.json was: %s", scored).isNotNull();
                assertThat(score.get("provenance").get("mode").get(0).asText()).isEqualTo("RUN");
                assertThat(score.get("provenance").get("rows").asInt()).isEqualTo(14);
            } else {
                assertThat(steps.get("score").asText()).contains("gold is not restored");
            }

            // The store really did take it, under the run id the approval named.
            Path stored = fixture.store().resolve("runs").resolve(fixture.manifest().runId());
            assertThat(stored.resolve("raw.jsonl")).exists();
            assertThat(stored.resolve("RUN.json")).exists();
            assertThat(Files.readString(stored.resolve("RUN.json"))).contains("transport=FAKE");

            assertNoCredentialAnywhere(ran, fixture.out());
            assertThat(Files.readString(stored.resolve("RUN.json"))).doesNotContain(CREDENTIAL);
        } finally {
            cleanUp(fixture);
        }
    }

    private static String idOf(String row) {
        try {
            return JSON.readTree(row).get("id").asText();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // --- the negative rehearsals --------------------------------------------------------------------------

    @Test
    @DisplayName("A — no credential: the command refuses before the first send and writes nothing")
    void missingCredentialSendsNothing(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);
            Map<String, String> env = fixture.env();
            env.remove(GoalRunLauncher.CREDENTIAL_ENV);

            Ran ran = launch(env, fixture.args());
            assertThat(ran.exit()).isEqualTo(3);
            assertThat(ran.report().get("status").asText()).isEqualTo("REFUSED");
            assertThat(ran.report().get("calls_attempted").asInt()).isZero();
            assertThat(ran.report().get("refusals").toString()).contains("CREDENTIAL_MISSING");
            assertNothingWasWritten(fixture.out());
        } finally {
            cleanUp(fixture);
        }
    }

    @Test
    @DisplayName("B — the operator named a different approval: refused on identity alone, zero sends")
    void wrongGrantedIdentitySendsNothing(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);
            List<String> args = new ArrayList<>(fixture.args());
            args.set(args.indexOf("--granted-approval") + 1, "apr-00000000-0000-0000-0000-000000000000");

            Ran ran = launch(fixture.env(), args);
            assertThat(ran.exit()).isEqualTo(3);
            assertThat(ran.report().get("refusals").toString()).contains("APPROVAL_ID");
            assertNothingWasWritten(fixture.out());

            List<String> runArgs = new ArrayList<>(fixture.args());
            runArgs.set(runArgs.indexOf("--granted-run") + 1, "v35-goal-smoke-not-this-one");
            Ran other = launch(fixture.env(), runArgs);
            assertThat(other.exit()).isEqualTo(3);
            assertThat(other.report().get("refusals").toString()).contains("RUN_ID");
            assertNothingWasWritten(fixture.out());
        } finally {
            cleanUp(fixture);
        }
    }

    @Test
    @DisplayName("C — the corpus moved under the approval: refused, zero sends")
    void changedInputsSendNothing(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);
            // The manifest is rewritten with one bound fingerprint moved, exactly as a corpus edit would move it.
            Path moved = dir.resolve("MOVED.json");
            GoalRunFixtures.moved(fixture.manifest(), "input_set_fp", "a-different-corpus").write(moved);
            List<String> args = new ArrayList<>(fixture.args());
            args.set(args.indexOf("--approval") + 1, moved.toString());

            Ran ran = launch(fixture.env(), args);
            assertThat(ran.exit()).isEqualTo(3);
            assertThat(ran.report().get("refusals").toString()).contains("input_set_fp");
            assertNothingWasWritten(fixture.out());
        } finally {
            cleanUp(fixture);
        }
    }

    @Test
    @DisplayName("D — the output already exists: refused before the first send, and the old run is untouched")
    void outputCollisionSendsNothing(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);
            Files.createDirectories(fixture.out());
            Files.writeString(fixture.out().resolve("rows.jsonl"), "{\"earlier\":\"run\"}\n");

            Ran ran = launch(fixture.env(), fixture.args());
            assertThat(ran.exit()).isEqualTo(3);
            assertThat(ran.report().get("refusals").toString()).contains("OUTPUT_EXISTS");
            assertThat(Files.readString(fixture.out().resolve("rows.jsonl"))).isEqualTo("{\"earlier\":\"run\"}\n");
            assertThat(Files.exists(fixture.out().resolve("raw.jsonl"))).isFalse();
            assertThat(Files.exists(fixture.out().resolve(GoalRunLauncher.STARTED))).isFalse();
        } finally {
            cleanUp(fixture);
        }
    }

    @Test
    @DisplayName("E — a commit made after the approval, and a dirty tree, each refuse at zero sends")
    void aMovedWorldSendsNothing(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);

            // Dirty first: an uncommitted file is enough, because a run must be attributable to a commit.
            Files.writeString(fixture.repo().resolve("scratch.txt"), "uncommitted\n");
            Ran dirty = launch(fixture.env(), fixture.args());
            assertThat(dirty.exit()).isEqualTo(3);
            assertThat(dirty.report().get("refusals").toString()).contains("tree_clean");
            assertNothingWasWritten(fixture.out());

            // Then commit it: the tree is clean again and the commit is not the one that was approved.
            GoalRunFixtures.commit(fixture.repo());
            Ran moved = launch(fixture.env(), fixture.args());
            assertThat(moved.exit()).isEqualTo(3);
            assertThat(moved.report().get("refusals").toString()).contains("commit");
            assertNothingWasWritten(fixture.out());
        } finally {
            cleanUp(fixture);
        }
    }

    @Test
    @DisplayName("F — killed mid-run: the answers already received are durable, and the run says it is unfinished")
    void anInterruptedRunKeepsWhatItAlreadyHeard(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);
            Map<String, String> env = fixture.env();
            env.put(GoalTransport.DIE_AFTER_ENV, "5");

            Ran ran = launch(env, fixture.args());
            assertThat(ran.exit()).as("a kill, not an orderly exit").isNotZero().isNotEqualTo(3);

            // Five answers arrived and five are on disk. Nothing was buffered waiting for an ending that never came.
            List<String> raw = Files.readAllLines(fixture.out().resolve("raw.jsonl"));
            assertThat(raw).hasSize(5);
            assertThat(raw).allSatisfy(row -> assertThat(JSON.readTree(row).get("raw").isNull()).isFalse());

            // And the directory says what it is: consumed, and not finished.
            assertThat(fixture.out().resolve(GoalRunLauncher.STARTED)).exists();
            assertThat(fixture.out().resolve(GoalRunLauncher.COMPLETE))
                    .as("an incomplete run never claims completion").doesNotExist();
            assertThat(Files.exists(fixture.out().resolve("score.json")))
                    .as("nothing downstream ran, so nothing downstream pretended to").isFalse();

            // Re-running does not quietly write over what survived.
            Ran again = launch(fixture.env(), fixture.args());
            assertThat(again.exit()).isEqualTo(3);
            assertThat(again.report().get("refusals").toString()).contains("OUTPUT_EXISTS");
            assertThat(Files.readAllLines(fixture.out().resolve("raw.jsonl"))).hasSize(5);
            assertNoCredentialAnywhere(ran, fixture.out());
        } finally {
            cleanUp(fixture);
        }
    }

    @Test
    @DisplayName("a rehearsal approval cannot be spent on a vendor, from the command line")
    void aRehearsalApprovalRefusesARealRun(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);
            Map<String, String> env = fixture.env();
            env.remove(GoalTransport.MODE_ENV);                       // ask for a real run...
            env.put(GoalRunLauncher.ENDPOINT_ENV, "https://vendor.invalid/v1/chat/completions");

            Ran ran = launch(env, fixture.args());
            assertThat(ran.exit()).isEqualTo(3);
            assertThat(ran.report().get("refusals").toString())
                    .as("the tool is part of the manifest").contains("transport");
            assertNothingWasWritten(fixture.out());
        } finally {
            cleanUp(fixture);
        }
    }

    @Test
    @DisplayName("the environment reaches the command, and the credential reaches only the transport")
    void theEnvironmentIsTheOnlySource(@TempDir Path dir) throws Exception {
        Fixture fixture = null;
        try {
            fixture = fixture(dir);
            // A .env and a .env.local sitting exactly where a careless loader would find them, carrying a value
            // that would work. They are git-ignored, so the world has not moved and the approval is still live —
            // which is what makes the next assertion mean something: the ONLY reason this run cannot proceed is
            // that the variable is absent from the process environment.
            Files.writeString(fixture.repo().resolve(".env"),
                    GoalRunLauncher.CREDENTIAL_ENV + "=" + CREDENTIAL + "\n");
            Files.writeString(fixture.repo().resolve(".env.local"),
                    GoalRunLauncher.CREDENTIAL_ENV + "=" + CREDENTIAL + "\n");

            Map<String, String> blindEnv = fixture.env();
            blindEnv.remove(GoalRunLauncher.CREDENTIAL_ENV);
            Ran blind = launch(blindEnv, fixture.args());
            assertThat(blind.exit()).isEqualTo(3);
            assertThat(blind.report().get("refusals").toString())
                    .as("a file on disk is not a credential source").contains("CREDENTIAL_MISSING");
            assertNothingWasWritten(fixture.out());

            // And with the variable back — same files, same everything — the run proceeds. So the difference
            // between refusing and running is the process environment and nothing else on disk.
            Ran sighted = launch(fixture.env(), fixture.args());
            assertThat(sighted.exit()).as("stderr was:\n%s", sighted.stderr()).isZero();
            assertThat(sighted.report().get("calls_attempted").asInt()).isEqualTo(14);
            assertNoCredentialAnywhere(sighted, fixture.out());
        } finally {
            cleanUp(fixture);
        }
    }
}
