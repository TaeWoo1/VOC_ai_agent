package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Mutation testing for the approval guard</b> (Inquiry v3.5).
 *
 * <p>A green suite says the code passes its tests. It does not say the tests would notice if the code stopped being
 * right — and this is the one class in the harness where not noticing means <b>spending money against an
 * authorization nobody gave</b>. So each mutation below breaks exactly one rule at the source level, compiles the
 * broken class, loads it in place of the real one, and asserts that a named property no longer holds.
 *
 * <p>This mirrors {@code tools/inquiry-need-eval/test/mutations.test.mjs}, which does the same thing for the scorer.
 * It is possible here only because {@link GoalRunGuard} was kept free of dependencies: a class whose imports are all
 * {@code java.util} compiles from source inside a test without dragging the application in behind it.
 */
class GoalRunGuardMutationTest {

    private static final String CLASS = "com.sellerops.inquiry.goal.GoalRunGuard";
    private static final Path SOURCE = Path.of("src", "test", "java", "com", "sellerops", "inquiry", "goal",
            "GoalRunGuard.java");

    private static Map<String, String> approved() {
        Map<String, String> m = new LinkedHashMap<>();
        for (String field : GoalRunGuard.BOUND) {
            m.put(field, "value-of-" + field);
        }
        return m;
    }

    /** Load a copy of the guard with one textual mutation applied, in place of the real one. */
    private static Class<?> mutant(String from, String to) throws Exception {
        String source = Files.readString(SOURCE);
        assertThat(source).as("mutation target not found: %s", from).contains(from);
        Path dir = Files.createTempDirectory("goal-guard-mutant");
        Path pkg = dir.resolve("com/sellerops/inquiry/goal");
        Files.createDirectories(pkg);
        Files.writeString(pkg.resolve("GoalRunGuard.java"), source.replace(from, to));
        Path classes = Files.createDirectories(dir.resolve("classes"));

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        assertThat(compiler).as("no javac — this test proves nothing without one, so it fails rather than skips")
                .isNotNull();
        int status = compiler.run(null, null, null, "-cp", System.getProperty("java.class.path"),
                "-d", classes.toString(), pkg.resolve("GoalRunGuard.java").toString());
        assertThat(status).as("the mutated source did not compile").isZero();

        URLClassLoader loader = new URLClassLoader(new URL[] {classes.toUri().toURL()},
                GoalRunGuardMutationTest.class.getClassLoader()) {
            @Override
            protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
                if (CLASS.equals(name)) {
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

    @SuppressWarnings("unchecked")
    private static List<String> refusalsOf(Class<?> guard, String approvalId, String runId,
                                           Map<String, String> actual) throws Exception {
        Method m = guard.getMethod("refusals", String.class, String.class, Map.class, String.class, String.class,
                Map.class);
        return (List<String>) m.invoke(null, "apr-1", "run-1", approved(), approvalId, runId, actual);
    }

    @Test
    @DisplayName("mutation is caught: a bound field may move without revoking the approval")
    void aMovedFieldMustRevoke() throws Exception {
        Map<String, String> moved = approved();
        moved.put("system_fp", "a-different-prompt");
        assertThat(GoalRunGuard.refusals("apr-1", "run-1", approved(), "apr-1", "run-1", moved))
                .as("the real guard holds the property").containsExactly("system_fp");

        Class<?> broken = mutant("            if (now == null || !was.equals(now)) {", "            if (false) {");
        assertThat(refusalsOf(broken, "apr-1", "run-1", moved))
                .as("a changed prompt was accepted against an old approval").isEmpty();
    }

    @Test
    @DisplayName("mutation is caught: a manifest with a hole in it may be bound to")
    void anIncompleteManifestMustBeRefused() throws Exception {
        Map<String, String> holed = approved();
        holed.remove("hard_cap");
        assertThat(GoalRunGuard.missing(holed)).containsExactly("hard_cap");

        Class<?> broken = mutant("            if (value == null || value.isBlank()) {", "            if (false) {");
        Method missing = broken.getMethod("missing", Map.class);
        assertThat((List<?>) missing.invoke(null, holed))
                .as("a manifest missing a bound field was treated as complete").isEmpty();
    }

    @Test
    @DisplayName("mutation is caught: the cap may be exceeded by exactly one")
    void theCapMustNotBeOffByOne() throws Exception {
        Class<?> broken = mutant("        if (calls >= cap) {", "        if (calls > cap) {");
        Method checkCap = broken.getMethod("checkCap", int.class, int.class);
        // The real guard refuses the 14th call under a cap of 13; the mutant lets it through.
        try {
            GoalRunGuard.checkCap(13, 13);
            throw new AssertionError("the real guard allowed a 14th call under a cap of 13");
        } catch (IllegalStateException expected) {
            assertThat(expected).hasMessageContaining("GOAL_MAX_CALLS");
        }
        checkCap.invoke(null, 13, 13); // the mutant does not throw: one call over, every time
    }

    @Test
    @DisplayName("mutation is caught: a run carrying the wrong approval id may proceed")
    void identityMustBeChecked() throws Exception {
        assertThat(GoalRunGuard.refusals("apr-1", "run-1", approved(), "apr-OTHER", "run-1", approved()))
                .containsExactly("APPROVAL_ID");

        Class<?> broken = mutant("        if (!approvedApprovalId.equals(attemptApprovalId)) {",
                "        if (false) {");
        assertThat(refusalsOf(broken, "apr-OTHER", "run-1", approved()))
                .as("another approval's id was accepted for this run").isEmpty();
    }

    @Test
    @DisplayName("mutation is caught: a field may quietly leave the bound set")
    void theBoundSetIsTheRevocationPolicy() throws Exception {
        assertThat(GoalRunGuard.BOUND).contains("input_set_fp");

        Class<?> broken = mutant("\"schema_fp\", \"input_set_fp\",", "\"schema_fp\",");
        Map<String, String> movedInputs = approved();
        movedInputs.put("input_set_fp", "a-different-corpus");
        assertThat(refusalsOf(broken, "apr-1", "run-1", movedInputs))
                .as("the input corpus changed and the approval survived it").isEmpty();

        List<String> bound = new ArrayList<>();
        ((List<?>) broken.getField("BOUND").get(null)).forEach(f -> bound.add(String.valueOf(f)));
        assertThat(bound).doesNotContain("input_set_fp");
    }
}
