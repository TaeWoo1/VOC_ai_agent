package com.sellerops.inquiry.goal;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * <b>A real approval, for tests</b> (Inquiry v3.5).
 *
 * <p>Every manifest here comes out of {@link GoalInterpreterPreflight} against a real committed checkout — never
 * hand-assembled. A test that built its own approval would be testing a shape rather than the thing the operator
 * actually reads, and the bound fields would agree because the same test wrote both sides.
 */
final class GoalRunFixtures {

    /** Obviously not a credential, and never sent anywhere: the fake transport is the only thing that sees it. */
    static final String FAKE_CREDENTIAL = "Bearer FAKE-TEST-CREDENTIAL-not-a-key";

    static final List<GoalSmokeInputs.Input> INPUTS = List.of(
            new GoalSmokeInputs.Input("G01", "제품 소재가 뭔가요?", true, null),
            new GoalSmokeInputs.Input("G04", "주문 취소해 주세요", true, null));

    private GoalRunFixtures() {
    }

    record Approved(Path repoRoot, ApprovalManifest manifest, List<CustomerGoalRunner.Input> inputs) {
        CustomerGoalRunner.World world(Path out) {
            return new CustomerGoalRunner.World(repoRoot, manifest.approvalId(), manifest.runId(), out);
        }
    }

    /**
     * A manifest prepared from the <b>real</b> assembly path: the committed fixture plus a store. Used by the
     * launcher tests, because the launcher assembles its own inputs and a manifest built from a hand-picked set
     * would disagree with it — as it did, loudly, the first time this was wired.
     *
     * <p>The store here is a temporary one carrying an obviously synthetic stand-in for the NO_GOAL row. No real
     * customer text is involved and none is written anywhere.
     */
    static Approved approvedFromFixture(Path root) throws Exception {
        Path fixture = root.resolve("contracts/inquiry-goal/v1/synthetic");
        Files.createDirectories(fixture);
        Files.copy(Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic", "goal-scenarios.jsonl"),
                fixture.resolve("goal-scenarios.jsonl"));
        commit(root);
        Map<String, String> env = new LinkedHashMap<>(fixtureEnv(root));
        var outcome = GoalInterpreterPreflight.prepare(root, env, null);
        if (outcome.manifest() == null) {
            throw new IllegalStateException("the fixture preflight was blocked: " + outcome.blockers());
        }
        var set = GoalSmokeInputs.assemble(fixture.resolve("goal-scenarios.jsonl"),
                GoalInterpreterPreflight.storeRoot(env));
        return new Approved(root, outcome.manifest(), set.usable().stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList());
    }

    /**
     * A <b>rehearsal</b> manifest, prepared by the same preflight with the environment asking for the fake.
     *
     * <p>Not a real manifest with a field edited: the rehearsal approval has to come out of the path an operator
     * would use, or the thing under test is a shape rather than the artifact. Its bound {@code transport} is
     * {@code FAKE}, so it refuses a vendor as firmly as a moved commit would.
     */
    static Approved approvedFake(Path root) throws Exception {
        Path fixture = root.resolve("contracts/inquiry-goal/v1/synthetic");
        Files.createDirectories(fixture);
        Files.copy(Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic", "goal-scenarios.jsonl"),
                fixture.resolve("goal-scenarios.jsonl"));
        commit(root);
        Map<String, String> env = new LinkedHashMap<>(fixtureEnv(root));
        env.put(GoalTransport.MODE_ENV, "FAKE");
        env.remove("SELLEROPS_INQUIRY_GOAL_ENDPOINT"); // a rehearsal has no endpoint to configure
        var outcome = GoalInterpreterPreflight.prepare(root, env, null);
        if (outcome.manifest() == null) {
            throw new IllegalStateException("the rehearsal preflight was blocked: " + outcome.blockers());
        }
        var set = GoalSmokeInputs.assemble(fixture.resolve("goal-scenarios.jsonl"),
                GoalInterpreterPreflight.storeRoot(env));
        return new Approved(root, outcome.manifest(), set.usable().stream()
                .map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList());
    }

    /** The environment a launcher test runs with: a temp store, a fake credential, a nowhere endpoint. */
    static Map<String, String> fixtureEnv(Path root) throws Exception {
        Path store = root.getParent().resolve("store").resolve("inquiry-planner-capture/v1");
        Files.createDirectories(store);
        Path capture = store.resolve("capture-S0.jsonl");
        if (!Files.exists(capture)) {
            Files.writeString(capture, "{\"q\":\"" + GoalSmokeInputs.NO_GOAL_CASE
                    + "\",\"question\":\"합성 스탠드인 문장입니다. 실제 고객 문장이 아닙니다.\"}\n");
        }
        Map<String, String> env = new LinkedHashMap<>();
        env.put("SELLEROPS_EVAL_CACHE", root.getParent().resolve("store").toString());
        // A unit test must never reach the operator's durable store, so it is pointed at a temporary directory —
        // which the store tool REFUSES by its own rule ("never in tmp"). That refusal is not an obstacle here, it
        // is the scenario: it makes every unit-level finalization take the failing branch, which is exactly where
        // the property worth asserting lives — a store that will not take the run leaves the run's raw untouched.
        // A finalization that SUCCEEDS is proven at Gradle-subprocess level by GoalSmokeRehearsalTest instead.
        env.put("SELLEROPS_EVAL_STORE", root.getParent().resolve("refused-store").toString());
        env.put("SELLEROPS_INQUIRY_GOAL_API_KEY", "FAKE-TEST-CREDENTIAL");
        env.put("SELLEROPS_INQUIRY_GOAL_ENDPOINT", "https://vendor.invalid/v1");
        return env;
    }

    /** A committed checkout carrying the one file the preflight reads, and a manifest prepared against it. */
    static Approved approved(Path root) throws Exception {
        Path fixture = root.resolve("contracts/inquiry-goal/v1/synthetic");
        Files.createDirectories(fixture);
        Files.copy(Path.of("..", "contracts", "inquiry-goal", "v1", "synthetic", "goal-scenarios.jsonl"),
                fixture.resolve("goal-scenarios.jsonl"));
        commit(root);
        Map<String, String> coverage = new LinkedHashMap<>();
        GoalSmokeInputs.INTENDED.keySet().forEach(k -> coverage.put(k, "covered by a supplied set"));
        var set = new GoalSmokeInputs.Set(INPUTS, List.of(), coverage);
        var outcome = GoalInterpreterPreflight.prepare(root,
                Map.of("SELLEROPS_INQUIRY_GOAL_API_KEY", "x", "SELLEROPS_INQUIRY_GOAL_ENDPOINT", "y"), set);
        if (outcome.manifest() == null) {
            throw new IllegalStateException("the fixture preflight was blocked: " + outcome.blockers());
        }
        return new Approved(root, outcome.manifest(),
                INPUTS.stream().map(i -> new CustomerGoalRunner.Input(i.id(), i.message())).toList());
    }

    static void commit(Path root) throws Exception {
        boolean fresh = !Files.exists(root.resolve(".git"));
        List<String[]> commands = new ArrayList<>();
        if (fresh) {
            commands.add(new String[] {"git", "init", "-q"});
            commands.add(new String[] {"git", "config", "user.email", "harness@example.invalid"});
            commands.add(new String[] {"git", "config", "user.name", "harness"});
        }
        commands.add(new String[] {"git", "add", "-A"});
        commands.add(new String[] {"git", "commit", "-q", "-m", "fixture"});
        for (String[] command : commands) {
            Process p = new ProcessBuilder(command).directory(root.toFile()).redirectErrorStream(true).start();
            if (p.waitFor() != 0) {
                throw new IllegalStateException(String.join(" ", command) + " failed");
            }
        }
    }

    /** The same manifest with exactly one bound field moved — "the approval says X, the world says Y". */
    static ApprovalManifest moved(ApprovalManifest m, String field, String value) {
        return new ApprovalManifest(m.approvalId(), m.runId(), m.preparedAt(),
                "commit".equals(field) ? value : m.commit(),
                "tree_clean".equals(field) ? Boolean.parseBoolean(value) : m.treeClean(),
                "runner".equals(field) ? value : m.runner(),
                "prompt_version".equals(field) ? value : m.promptVersion(),
                "system_fp".equals(field) ? value : m.systemFp(),
                "schema_fp".equals(field) ? value : m.schemaFp(),
                "input_set_fp".equals(field) ? value : m.inputSetFp(),
                "request_fp_set".equals(field) ? value : m.requestFpSet(),
                "model".equals(field) ? value : m.model(),
                "reasoning_effort".equals(field) ? value : m.reasoningEffort(),
                "calls".equals(field) ? Integer.parseInt(value) : m.calls(),
                "hard_cap".equals(field) ? Integer.parseInt(value) : m.hardCap(),
                "retry_policy".equals(field) ? value : m.retryPolicy(),
                "scope".equals(field) ? value : m.scope(),
                "transport".equals(field) ? value : m.transport(),
                m.realCustomerText(), m.inputIds(), m.requestFps(), m.environment(), m.outputLocation(),
                Map.of(), List.of());
    }

    /** A transport that counts what it was asked to send, so "zero sends" is a number rather than a belief. */
    static final class Counting implements AgentLlmTransport {
        final AtomicInteger sends = new AtomicInteger();
        private final String content;

        Counting(String content) {
            this.content = content;
        }

        @Override
        public Response post(java.net.URI uri, Map<String, String> headers, String body) {
            sends.incrementAndGet();
            return new Response(200, vendor(content), 1L);
        }
    }

    static String vendor(String content) {
        return "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":"
                + quote(content) + "}}]}";
    }

    private static String quote(String s) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') {
                out.append('\\');
            }
            out.append(c);
        }
        return out.append('"').toString();
    }

    /** Answers {@link #INPUTS}' first row, so its v2 {@code evidence} is a real span of that row's message. */
    static final String GOOD_ANSWER = "{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"제품 소재가 뭔가요?\","
            + "\"requested_outcome\":\"INFORMATION\",\"subject\":\"CURRENT_LISTING\",\"basis\":\"STATED\","
            + "\"explicit_constraints\":[],\"evidence\":\"제품 소재가 뭔가요?\"}],\"relations\":[]}";

    /** Collects rows, and remembers the order the two sinks were called in. */
    static final class Recording implements CustomerGoalRunner.Sink {
        final List<String> raw = new ArrayList<>();
        final List<String> rows = new ArrayList<>();
        final List<String> order = new ArrayList<>();

        @Override
        public void raw(String row) {
            raw.add(row);
            order.add("raw");
        }

        @Override
        public void row(String row) {
            rows.add(row);
            order.add("row");
        }
    }

    static CustomerGoalRunner runner(AgentLlmTransport transport, Map<String, String> headers) {
        return new CustomerGoalRunner(GoalInterpreterPreflight.MODEL, GoalInterpreterPreflight.REASONING_EFFORT,
                transport, java.net.URI.create("https://vendor.invalid/v1/chat/completions"), headers);
    }

    static Map<String, String> credential() {
        return Map.of(CustomerGoalRunner.AUTHORIZATION, FAKE_CREDENTIAL, "Content-Type", "application/json");
    }
}
