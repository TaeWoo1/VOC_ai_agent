package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.lang.reflect.Method;
import java.net.URI;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * <b>The mutation that matters most</b> (Inquiry v3.5 §23.9).
 *
 * <p>{@code GoalRunGuardMutationTest} proves the guard's rules are right. This proves the <b>run asks it</b> — and
 * those are different claims. The package before this one had a guard that was correct, exhaustively tested,
 * mutation-tested, and <b>called by nothing</b>: {@code refusals()} had zero non-test callers, so a moved commit or
 * a changed prompt would not have been refused, it would simply never have been examined.
 *
 * <p>A unit test of a guard cannot see that. Only this can: take the send path, delete the call to the guard,
 * and check that an approval which should be refused now sends.
 */
class CustomerGoalRunnerMutationTest {

    private static final String CLASS = "com.sellerops.inquiry.goal.CustomerGoalRunner";
    private static final Path SOURCE = Path.of("src", "test", "java", "com", "sellerops", "inquiry", "goal",
            "CustomerGoalRunner.java");

    /** The whole guard consultation, as it stands in the send path. */
    private static final String THE_CALL = """
                    List<String> refusals = GoalRunGuard.refusals(approval.approvalId(), approval.runId(), approval.bound(),
                            world.grantedApprovalId(), world.grantedRunId(), current(world.repoRoot(), inputs, requests));
                    if (!refusals.isEmpty()) {
                        throw new Refused(refusals);
                    }""".stripIndent().indent(8).stripTrailing();

    private static Class<?> mutant(String from, String to) throws Exception {
        String source = Files.readString(SOURCE);
        assertThat(source).as("mutation target not found").contains(from);
        Path dir = Files.createTempDirectory("goal-runner-mutant");
        Path pkg = Files.createDirectories(dir.resolve("com/sellerops/inquiry/goal"));
        Files.writeString(pkg.resolve("CustomerGoalRunner.java"), source.replace(from, to));
        Path classes = Files.createDirectories(dir.resolve("classes"));

        var compiler = javax.tools.ToolProvider.getSystemJavaCompiler();
        assertThat(compiler).as("no javac — this proves nothing without one, so it fails rather than skips")
                .isNotNull();
        assertThat(compiler.run(null, null, null, "-cp", System.getProperty("java.class.path"),
                "-d", classes.toString(), pkg.resolve("CustomerGoalRunner.java").toString()))
                .as("the mutated source did not compile").isZero();

        URLClassLoader loader = new URLClassLoader(new URL[] {classes.toUri().toURL()},
                CustomerGoalRunnerMutationTest.class.getClassLoader()) {
            @Override
            protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
                if (CLASS.equals(name) || name.startsWith(CLASS + "$")) {
                    synchronized (getClassLoadingLock(name)) {
                        Class<?> found = findLoadedClass(name);
                        if (found == null) {
                            found = findClass(name);
                        }
                        if (resolve) {
                            resolveClass(found);
                        }
                        return found;
                    }
                }
                return super.loadClass(name, resolve);
            }
        };
        return loader.loadClass(CLASS);
    }

    @Test
    @DisplayName("mutation is caught: RUN stops asking the guard, and a revoked approval sends anyway")
    void removingTheGuardCallFromRunIsCaught(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        // An approval that must be refused: it names a model this runner is not running.
        var revoked = GoalRunFixtures.moved(approved.manifest(), "model", "some-other-model");
        var world = new CustomerGoalRunner.World(approved.repoRoot(), revoked.approvalId(), revoked.runId(),
                dir.resolve("rows.jsonl"));

        // The real runner: refused, and the transport is never touched.
        var real = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        assertThatThrownBy(() -> GoalRunFixtures.runner(real, GoalRunFixtures.credential())
                .send(revoked, world, approved.inputs(), new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class);
        assertThat(real.sends.get()).as("the real runner holds the property").isZero();

        // The same run, with the guard consultation deleted from the send path.
        Class<?> broken = mutant(THE_CALL, "");
        var mutated = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        int sent = sendVia(broken, mutated, revoked, approved, dir.resolve("mutant.jsonl"));
        assertThat(sent).as("the guard was not asked and the run happened anyway")
                .isEqualTo(approved.inputs().size()).isPositive();
        assertThat(mutated.sends.get()).isPositive();
    }

    @Test
    @DisplayName("mutation is caught: raw stops being written before what is derived from it")
    void reversingTheRawBeforeDerivedOrderIsCaught(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));

        // The real runner: the observation reaches the sink before the reading of it, every time.
        var honest = new GoalRunFixtures.Recording();
        GoalRunFixtures.runner(new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER),
                        GoalRunFixtures.credential())
                .send(approved.manifest(), approved.world(dir.resolve("rows.jsonl")), approved.inputs(), honest);
        assertThat(honest.order).containsExactly("raw", "row", "raw", "row");

        // The same run with the two calls swapped, so a derivation that throws could take the answer with it.
        Class<?> broken = mutant(THE_ORDER, """
                            String row = row(runId, mode, request, content, said, failure, finish, elapsed);
                            sink.row(row);
                            sink.raw(raw(runId, mode, request, content, said, failure, finish, elapsed));"""
                .stripIndent().indent(12).stripTrailing());
        List<String> order = new ArrayList<>();
        sendVia(broken, new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER), approved.manifest(), approved,
                dir.resolve("mutant.jsonl"), order);
        assertThat(order).as("the mutant derives first, which is the failure mode this ordering exists to stop")
                .startsWith("row", "raw");
    }

    @Test
    @DisplayName("mutation is caught: the tool stops being re-read, and a rehearsal approval drives a vendor")
    void droppingTheTransportBindingIsCaught(@TempDir Path dir) throws Exception {
        var approved = GoalRunFixtures.approved(dir.resolve("repo"));
        // A manifest approved for a REHEARSAL. A real-shaped transport must not be able to spend it.
        var rehearsal = GoalRunFixtures.moved(approved.manifest(), "transport", "FAKE");
        var world = new CustomerGoalRunner.World(approved.repoRoot(), rehearsal.approvalId(), rehearsal.runId(),
                dir.resolve("rows.jsonl"));

        var real = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        assertThatThrownBy(() -> GoalRunFixtures.runner(real, GoalRunFixtures.credential())
                .send(rehearsal, world, approved.inputs(), new GoalRunFixtures.Recording()))
                .isInstanceOf(CustomerGoalRunner.Refused.class);
        assertThat(real.sends.get()).as("the real runner holds the property").isZero();

        // Deleting the line outright is NOT the mutation worth testing: the guard already refuses a field the
        // world cannot answer for, so the run stops anyway. The dangerous edit is the one where the tool is still
        // reported and stops being READ — a constant in place of a question put to the transport in hand.
        Class<?> broken = mutant("m.put(\"transport\", GoalTransport.modeOf(transport));",
                "m.put(\"transport\", \"FAKE\");");
        var mutated = new GoalRunFixtures.Counting(GoalRunFixtures.GOOD_ANSWER);
        int sent = sendVia(broken, mutated, rehearsal, approved, dir.resolve("mutant.jsonl"), new ArrayList<>());
        assertThat(sent).as("a rehearsal approval was spent on a run that was not a rehearsal")
                .isEqualTo(approved.inputs().size()).isPositive();
    }

    /** The raw-before-derived pair, as it stands in the loop. */
    private static final String THE_ORDER = """
                        sink.raw(raw(runId, mode, request, content, said, failure, finish, elapsed));
                        String row = row(runId, mode, request, content, said, failure, finish, elapsed);
                        sink.row(row);""".stripIndent().indent(12).stripTrailing();

    /** Drive the mutated class reflectively: its {@code World} and {@code Sink} are its own types, not ours. */
    private static int sendVia(Class<?> runnerClass, GoalRunFixtures.Counting transport, ApprovalManifest approval,
                               GoalRunFixtures.Approved approved, Path out) throws Exception {
        return sendVia(runnerClass, transport, approval, approved, out, new ArrayList<>());
    }

    private static int sendVia(Class<?> runnerClass, GoalRunFixtures.Counting transport, ApprovalManifest approval,
                               GoalRunFixtures.Approved approved, Path out, List<String> order) throws Exception {
        Class<?> worldClass = Class.forName(CLASS + "$World", true, runnerClass.getClassLoader());
        Class<?> sinkClass = Class.forName(CLASS + "$Sink", true, runnerClass.getClassLoader());
        Class<?> inputClass = Class.forName(CLASS + "$Input", true, runnerClass.getClassLoader());

        Object runner = runnerClass.getConstructor(String.class, String.class,
                        com.sellerops.agent.llm.AgentLlmTransport.class, URI.class, java.util.Map.class)
                .newInstance(GoalInterpreterPreflight.MODEL, GoalInterpreterPreflight.REASONING_EFFORT, transport,
                        URI.create("https://vendor.invalid/v1"), GoalRunFixtures.credential());
        Object world = worldClass.getConstructor(Path.class, String.class, String.class, Path.class)
                .newInstance(approved.repoRoot(), approval.approvalId(), approval.runId(), out);
        Object sink = java.lang.reflect.Proxy.newProxyInstance(runnerClass.getClassLoader(),
                new Class<?>[] {sinkClass}, (proxy, method, methodArgs) -> {
                    order.add(method.getName());
                    return null;
                });

        List<Object> inputs = approved.inputs().stream().map(i -> {
            try {
                return inputClass.getConstructor(String.class, String.class).newInstance(i.id(), i.message());
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }).map(Object.class::cast).toList();

        Method send = runnerClass.getMethod("send", ApprovalManifest.class, worldClass, List.class, sinkClass);
        Object result = send.invoke(runner, approval, world, inputs, sink);
        return (int) result.getClass().getMethod("calls").invoke(result);
    }
}
