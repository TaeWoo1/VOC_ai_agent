package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.agent.llm.JdkAgentLlmTransport;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Which tool a run is allowed to be</b> (Inquiry v3.5 §23.10).
 *
 * <p>Two properties, and the second is the one that matters. The first is that {@code REAL} is what you get unless
 * you ask precisely for the other thing. The second is that a rehearsal approval and a vendor approval <b>cannot be
 * exchanged</b>: the guard refuses the crossing in both directions, because the tool is a bound field and not a note
 * beside the manifest.
 */
class GoalTransportTest {

    private static Map<String, String> env(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.put(kv[i], kv[i + 1]);
        }
        return m;
    }

    @Test
    @DisplayName("REAL is what an unset, blank or misspelled variable means")
    void realIsTheDefault() {
        assertThat(GoalTransport.mode(null)).isEqualTo(GoalTransport.Mode.REAL);
        assertThat(GoalTransport.mode(Map.of())).isEqualTo(GoalTransport.Mode.REAL);
        for (String near : List.of("", "  ", "fake", "Fake", "FAKE_", "F AKE", "TRUE", "1", "REAL")) {
            assertThat(GoalTransport.mode(env(GoalTransport.MODE_ENV, near)))
                    .as("%s must not select the fake", near).isEqualTo(GoalTransport.Mode.REAL);
        }
        assertThat(GoalTransport.mode(env(GoalTransport.MODE_ENV, "FAKE"))).isEqualTo(GoalTransport.Mode.FAKE);
        assertThat(GoalTransport.mode(env(GoalTransport.MODE_ENV, " FAKE "))).isEqualTo(GoalTransport.Mode.FAKE);
    }

    @Test
    @DisplayName("REAL demands an endpoint; FAKE has one that cannot be dialled and ignores the environment's")
    void endpointsAreNotInterchangeable() {
        assertThatThrownBy(() -> GoalTransport.endpoint(GoalTransport.Mode.REAL, Map.of()))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons())
                        .containsExactly("ENV_MISSING:" + GoalRunLauncher.ENDPOINT_ENV));

        // A vendor URL left over in the shell does not become a rehearsal's destination.
        var withVendor = env(GoalRunLauncher.ENDPOINT_ENV, "https://api.example.com/v1/chat/completions");
        assertThat(GoalTransport.endpoint(GoalTransport.Mode.FAKE, withVendor))
                .isEqualTo(GoalTransport.FAKE_ENDPOINT);
        assertThat(GoalTransport.FAKE_ENDPOINT.getScheme()).as("no client dials this").isEqualTo("fake");
        assertThat(GoalTransport.endpoint(GoalTransport.Mode.REAL, withVendor).toString())
                .isEqualTo("https://api.example.com/v1/chat/completions");
    }

    @Test
    @DisplayName("the mode is read off the transport in hand, and only the fake answers FAKE")
    void theModeIsAPropertyOfTheObject() {
        assertThat(GoalTransport.modeOf(GoalTransport.of(GoalTransport.Mode.FAKE, Map.of()))).isEqualTo("FAKE");
        assertThat(GoalTransport.modeOf(GoalTransport.of(GoalTransport.Mode.REAL, Map.of()))).isEqualTo("REAL");
        assertThat(GoalTransport.modeOf(new JdkAgentLlmTransport())).isEqualTo("REAL");
        // A transport a test wrote is REAL — the direction a rehearsal manifest refuses, rather than the direction
        // a real manifest would admit.
        assertThat(GoalTransport.modeOf(new GoalRunFixtures.Counting("{}"))).isEqualTo("REAL");
    }

    @Test
    @DisplayName("the fake answers every request identically, legally, and only at its own address")
    void theFakeIsDeterministicAndPenned() {
        var fake = GoalTransport.of(GoalTransport.Mode.FAKE, Map.of());
        var first = fake.post(GoalTransport.FAKE_ENDPOINT, Map.of(), "{\"a\":1}");
        var second = fake.post(GoalTransport.FAKE_ENDPOINT, Map.of(), "{\"b\":2}");
        assertThat(first.status()).isEqualTo(200);
        assertThat(first.body()).isEqualTo(second.body()).contains("\"finish_reason\":\"stop\"");

        assertThatThrownBy(() -> fake.post(java.net.URI.create("https://api.example.com/v1"), Map.of(), "{}"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("aimed at");
    }

    @Test
    @DisplayName("a rehearsal approval cannot drive a vendor, and a vendor approval cannot be spent on a rehearsal")
    void theTwoApprovalsDoNotCross(@org.junit.jupiter.api.io.TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));   // prepared REAL
        assertThat(approved.manifest().transport()).isEqualTo("REAL");

        // REAL manifest, rehearsal transport: refused, and nothing is answered.
        var fake = GoalTransport.of(GoalTransport.Mode.FAKE, Map.of());
        var runner = new CustomerGoalRunner(GoalInterpreterPreflight.MODEL, GoalInterpreterPreflight.REASONING_EFFORT,
                fake, GoalTransport.FAKE_ENDPOINT, GoalRunFixtures.credential());
        assertThatThrownBy(() -> runner.send(approved.manifest(),
                approved.world(dir.resolve("a.jsonl")), approved.inputs(), new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons()).containsExactly("transport"));

        // FAKE manifest, real-shaped transport: refused the same way, by the same field.
        var rehearsal = GoalRunFixtures.moved(approved.manifest(), "transport", "FAKE");
        var counting = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        var real = GoalRunFixtures.runner(counting, GoalRunFixtures.credential());
        assertThatThrownBy(() -> real.send(rehearsal, new CustomerGoalRunner.World(approved.repoRoot(),
                rehearsal.approvalId(), rehearsal.runId(), dir.resolve("b.jsonl")),
                approved.inputs(), new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class)
                .satisfies(e -> assertThat(((CustomerGoalRunner.Refused) e).reasons()).containsExactly("transport"));
        assertThat(counting.sends.get()).isZero();
    }

    @Test
    @DisplayName("a rehearsal manifest says what it is, on its face and on every row it produces")
    void aRehearsalDeclaresItself(@org.junit.jupiter.api.io.TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approvedFake(dir.resolve("repo"));
        assertThat(approved.manifest().transport()).isEqualTo("FAKE");
        assertThat(approved.manifest().toJson().toString()).contains("REHEARSAL MANIFEST")
                .contains("CANNOT be spent on a vendor");

        var sink = new GoalRunFixtures.Recording();
        var runner = new CustomerGoalRunner(approved.manifest().model(), approved.manifest().reasoningEffort(),
                GoalTransport.of(GoalTransport.Mode.FAKE, Map.of()), GoalTransport.FAKE_ENDPOINT,
                GoalRunFixtures.credential());
        var result = runner.send(approved.manifest(), approved.world(dir.resolve("rows.jsonl")),
                approved.inputs(), sink);
        assertThat(result.calls()).isEqualTo(approved.inputs().size());
        assertThat(sink.raw).allSatisfy(row -> assertThat(row).contains("\"transport\":\"FAKE\""));
        assertThat(sink.rows).allSatisfy(row -> assertThat(row).contains("\"transport\":\"FAKE\""));
    }

    @Test
    @DisplayName("a rehearsal does not need an endpoint, and a real run does")
    void whatEachModeAsksOfTheShell() {
        assertThat(GoalInterpreterPreflight.requiredEnv(GoalTransport.Mode.REAL))
                .containsExactlyElementsOf(GoalInterpreterPreflight.REQUIRED_ENV);
        assertThat(GoalInterpreterPreflight.requiredEnv(GoalTransport.Mode.FAKE))
                .containsExactly("SELLEROPS_INQUIRY_GOAL_API_KEY");
        // The credential is required in BOTH — proving a value put on the command line reaches the transport is
        // most of what a rehearsal is for, and dropping it would remove the thing being rehearsed.
        assertThat(GoalInterpreterPreflight.requiredEnv(GoalTransport.Mode.FAKE))
                .contains(GoalRunLauncher.CREDENTIAL_ENV);
    }

    @Test
    @DisplayName("the fake lives in the test tree and no production class can reach it")
    void theFakeIsNotReachableFromTheApplication() throws Exception {
        Path main = Path.of("src", "main", "java");
        assertThat(Files.exists(main)).isTrue();
        try (var paths = Files.walk(main)) {
            List<Path> mentions = paths.filter(p -> p.toString().endsWith(".java")).filter(p -> {
                try {
                    String s = Files.readString(p);
                    return s.contains("GoalTransport") || s.contains("GoalRunLauncher")
                            || s.contains("CustomerGoalRunner");
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            }).toList();
            assertThat(mentions).as("the interpreter harness still has zero production callers").isEmpty();
        }
    }
}
