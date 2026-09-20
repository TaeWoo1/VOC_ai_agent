package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * <b>The operator's actual command</b> (Inquiry v3.5 §23.10).
 *
 * <p>Two tests of two different things, and the split is deliberate.
 *
 * <p>The first is <b>always on</b> and guards the task's wiring from drifting: that {@code runGoalSmoke} runs on the
 * <i>test</i> runtime classpath at the launcher's entrypoint, and therefore that adding a production caller is not
 * something this task could ever quietly do. A wiring fact is worth pinning even though it reads as bookkeeping —
 * the previous package's whole defect was a correct component connected to nothing.
 *
 * <p>The second <b>starts Gradle for real</b> and is gated behind {@link #PROOF}, because a Gradle build launched
 * from inside a Gradle build contends for the same daemon and locks and has no business running on every commit.
 * It is the one that answers the question a wiring assertion cannot: does a value typed on the command line in front
 * of {@code ./gradlew} actually arrive in the JVM the task starts? Gradle's daemon can answer {@code System.getenv()}
 * with the environment it was <i>started</i> with, and a credential that silently fails to arrive is indistinguishable
 * from one that is wrong — so the documented command says {@code --no-daemon} and this measures it.
 */
class GoalSmokeGradleTaskTest {

    /** Set to {@code 1} to run the real build. Off by default: Gradle inside Gradle is not a CI-shaped thing. */
    static final String PROOF = "SELLEROPS_GOAL_SMOKE_GRADLE_PROOF";

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    @DisplayName("the task runs the launcher on the test classpath, and could not run a production caller")
    void theTaskIsWiredToTheHarnessAndNotToTheApplication() throws Exception {
        String build = Files.readString(Path.of("build.gradle"));
        assertThat(build).contains("tasks.register('runGoalSmoke', JavaExec)");
        assertThat(build).contains("mainClass = 'com.sellerops.inquiry.goal.GoalRunLauncher'");
        assertThat(build).contains("classpath = sourceSets.test.runtimeClasspath");
        // Never the main source set: the interpreter has no production caller and this task must not become one.
        assertThat(build).doesNotContain("sourceSets.main.runtimeClasspath");
        assertThat(build).contains("dependsOn tasks.named('testClasses')");

        // The other half of the pair. Before it existed, the manifest an operator granted against was lifted out
        // of a test artifact — which works, and quietly makes the approval a by-product of running the suite.
        assertThat(build).contains("tasks.register('prepareGoalSmoke', JavaExec)");
        assertThat(build).contains("mainClass = 'com.sellerops.inquiry.goal.GoalInterpreterPreflight'");
        assertThat(GoalInterpreterPreflight.class.getMethod("main", String[].class)).isNotNull();

        // The entrypoint the task names exists, is the launcher's, and takes the arguments the command passes.
        assertThat(GoalRunLauncher.class.getName()).isEqualTo("com.sellerops.inquiry.goal.GoalRunLauncher");
        assertThat(GoalRunLauncher.class.getMethod("main", String[].class)).isNotNull();
        // And the launcher lives in the test tree, so nothing shipped can reach it.
        assertThat(Files.exists(Path.of("src", "test", "java", "com", "sellerops", "inquiry", "goal",
                "GoalRunLauncher.java"))).isTrue();
        assertThat(Files.exists(Path.of("src", "main", "java", "com", "sellerops", "inquiry", "goal",
                "GoalRunLauncher.java"))).isFalse();
    }

    @Test
    @DisplayName("the real Gradle command carries the environment into the run — fourteen fake sends, no network")
    void theRealCommandCarriesTheEnvironment(@TempDir Path dir) throws Exception {
        if (!"1".equals(System.getenv(PROOF))) {
            return;   // gated; see the class comment
        }
        Path repoRoot = Path.of("..").toAbsolutePath().normalize();
        assertThat(RepoState.clean(repoRoot))
                .as("this proof runs the real task against the real worktree, which must be committed").isTrue();

        Path scratchStore = Path.of(System.getProperty("user.home"), ".cache", "sellerops-goal-rehearsal",
                UUID.randomUUID().toString());
        Files.createDirectories(scratchStore);
        try {
            Map<String, String> env = new LinkedHashMap<>();
            env.put("SELLEROPS_EVAL_CACHE", GoalInterpreterPreflight.storeRoot(Map.of()).toString());
            env.put("SELLEROPS_EVAL_STORE", scratchStore.toString());
            env.put(GoalRunLauncher.CREDENTIAL_ENV, "GRADLE-PROOF-CREDENTIAL-not-a-real-key");
            env.put(GoalTransport.MODE_ENV, "FAKE");

            var outcome = GoalInterpreterPreflight.prepare(repoRoot, env, null);
            assertThat(outcome.manifest()).as("preflight was blocked: %s", outcome.blockers()).isNotNull();
            Path manifest = dir.resolve("APPROVAL.json");
            outcome.manifest().write(manifest);

            List<String> command = List.of("./gradlew", "--no-daemon", "-q", "--offline", "runGoalSmoke",
                    "--args=--approval " + manifest + " --granted-approval " + outcome.manifest().approvalId()
                            + " --granted-run " + outcome.manifest().runId() + " --out " + dir.resolve("out"));
            ProcessBuilder builder = new ProcessBuilder(new ArrayList<>(command))
                    .directory(Path.of(".").toAbsolutePath().normalize().toFile());
            builder.environment().putAll(env);
            Process process = builder.start();
            String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            int exit = process.waitFor();
            assertThat(exit).as("stdout:\n%s\nstderr:\n%s", stdout, stderr).isZero();

            JsonNode report = JSON.readTree(stdout.substring(stdout.indexOf('{')));
            assertThat(report.get("status").asText()).isEqualTo("COMPLETE");
            assertThat(report.get("calls_attempted").asInt()).isEqualTo(14);
            assertThat(report.get("transport").asText()).isEqualTo("FAKE");
            assertThat(report.get("run_verify").asText()).isEqualTo("ok");
            assertThat(Files.readAllLines(dir.resolve("out").resolve("raw.jsonl"))).hasSize(14);
            assertThat(stdout + stderr).doesNotContain("GRADLE-PROOF-CREDENTIAL");
        } finally {
            if (Files.exists(scratchStore)) {
                try (var paths = Files.walk(scratchStore)) {
                    for (Path p : paths.sorted(Comparator.reverseOrder()).toList()) {
                        p.toFile().setWritable(true);
                        Files.deleteIfExists(p);
                    }
                }
            }
        }
    }
}
