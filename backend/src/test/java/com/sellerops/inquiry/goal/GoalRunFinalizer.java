package com.sellerops.inquiry.goal;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <b>Everything after the last answer</b> (Inquiry v3.5 §23.10) — scoring, storage and verification, run by the same
 * command that did the sending.
 *
 * <p>It exists because the alternative was a sentence. The launcher used to end by <i>printing</i> "next: run
 * store.mjs", which makes the durability of a run depend on an operator reading a line at the end of a long log and
 * typing it correctly, at the one moment the artifacts are least reproducible. A step a human has to remember is a
 * step that is sometimes not taken.
 *
 * <h2>Raw is primary truth, and nothing here may touch it</h2>
 *
 * <p>Every method below <b>adds</b> files and reads others. None of them writes to {@code raw.jsonl} or
 * {@code rows.jsonl}, none deletes anything, and a failure in any step is <b>recorded and carried</b> rather than
 * thrown out of the run: a scorer that cannot find its gold, a store that refuses a duplicate, a missing {@code node}
 * — all of them leave the vendor's answers exactly where they landed. A model's answer cannot be produced a second
 * time; a score can be recomputed from the rows for as long as the rows exist.
 */
final class GoalRunFinalizer {

    /** Where the frozen goal gold lives once restored, relative to the eval cache root. */
    static final String GOLD = "inquiry-customer-goal/v3/goals.jsonl";

    static final String RESTORE_GOLD = "node tools/eval-store/store.mjs restore inquiry-customer-goal v3";

    static final String STORE = "tools/eval-store/store.mjs";

    /**
     * A script's real absolute path.
     *
     * <p>Node decides whether a module is "being run directly" by comparing {@code import.meta.url} with
     * {@code process.argv[1]}, and it resolves the first through symlinks and the second not at all. Handing it a
     * path that goes through a link therefore starts a script that <b>silently does nothing and exits zero</b> —
     * which is how a run can be reported as scored with an empty score beside it. Resolving here makes the two
     * agree however the caller reached the repository.
     */
    private static String script(Path repoRoot, String relative) {
        Path path = repoRoot.resolve(relative);
        try {
            return path.toRealPath().toString();
        } catch (Exception e) {
            return path.toAbsolutePath().toString();
        }
    }

    private GoalRunFinalizer() {
    }

    /** One step's outcome: what it was asked to do, whether it worked, and what it said. Never a secret. */
    record Step(String name, boolean ok, String detail) {
        static Step ok(String name, String detail) {
            return new Step(name, true, detail);
        }

        static Step failed(String name, String detail) {
            return new Step(name, false, detail);
        }
    }

    /**
     * Score the recorded rows against the frozen gold, writing {@code score.json} beside them.
     *
     * <p>Reads what the runner <b>wrote</b>, exactly as the standalone scorer does, and by invoking that same script
     * rather than a second copy of it — a scorer the launcher reimplemented would be a second definition of the
     * metric that is right until the day it is not.
     */
    static Step score(Path repoRoot, Path out, Path cacheRoot, Map<String, String> env) {
        Path rows = out.resolve("rows.jsonl");
        if (!Files.exists(rows)) {
            return Step.failed("score", "no rows.jsonl — nothing was recorded to score");
        }
        Path gold = cacheRoot == null ? null : cacheRoot.resolve(GOLD);
        if (gold == null || !Files.exists(gold)) {
            return Step.failed("score", "the frozen gold is not restored here; run `" + RESTORE_GOLD + "`");
        }
        Path scoreFile = out.resolve("score.json");
        if (Files.exists(scoreFile)) {
            return Step.failed("score", "score.json already exists — a recorded score is never overwritten");
        }
        Shell.Result result = Shell.run(repoRoot, env, "node", script(repoRoot,
                "tools/inquiry-need-eval/score-goal-run.mjs"), rows.toString(), gold.toString());
        if (!result.ok()) {
            return Step.failed("score", "the scorer exited " + result.exit() + ": " + result.tail());
        }
        if (result.stdout().isBlank()) {
            // A zero exit with nothing on stdout is the shape a node script takes when its "am I the entry point"
            // check said no. It is not a score, and writing an empty file under that name would make the run
            // report say "ok" about a file with nothing in it.
            return Step.failed("score", "the scorer exited 0 and printed nothing — it did not run");
        }
        try {
            Files.writeString(scoreFile, result.stdout(), StandardCharsets.UTF_8,
                    java.nio.file.StandardOpenOption.CREATE_NEW);
        } catch (Exception e) {
            return Step.failed("score", "score.json could not be written: " + e.getMessage());
        }
        return Step.ok("score", scoreFile.toString());
    }

    /** Put every artifact in this directory into the durable store, append-only and marked irreproducible. */
    static Step put(Path repoRoot, String runId, Path out, String transport, Map<String, String> env) {
        Shell.Result result = Shell.run(repoRoot, env, "node", script(repoRoot, STORE), "run-put", runId,
                out.toString(), "--irreproducible", "--note",
                "Inquiry v3.5 Customer Goal Interpreter smoke — transport=" + transport);
        return result.ok() ? Step.ok("run-put", result.tail())
                : Step.failed("run-put", "exited " + result.exit() + ": " + result.tail());
    }

    /** Read every stored artifact back and check its digest. */
    static Step verify(Path repoRoot, String runId, Map<String, String> env) {
        Shell.Result result = Shell.run(repoRoot, env, "node", script(repoRoot, STORE), "run-verify", runId);
        return result.ok() ? Step.ok("run-verify", result.tail())
                : Step.failed("run-verify", "exited " + result.exit() + ": " + result.tail());
    }

    /**
     * The whole tail of a run, in order, each step's outcome carried rather than thrown.
     *
     * <p>Scoring happens <b>before</b> storage so the score travels with the rows it describes, and verification
     * last so that what it verifies is everything.
     */
    static List<Step> finish(Path repoRoot, String runId, Path out, Path cacheRoot, String transport,
                             Map<String, String> env) {
        List<Step> steps = new ArrayList<>();
        steps.add(score(repoRoot, out, cacheRoot, env));
        steps.add(put(repoRoot, runId, out, transport, env));
        steps.add(verify(repoRoot, runId, env));
        return List.copyOf(steps);
    }

    /**
     * A subprocess, with its output captured and <b>the credential deliberately taken away from it</b>.
     *
     * <p>Neither the scorer nor the store has any use for the key, and both would otherwise inherit it simply
     * because they are children of a process that holds one. Removing it means a crash dump, an error message or a
     * stray {@code env} inside either tool cannot contain a secret that was never theirs to see. What is forwarded
     * instead is only what locates the store, so the tools read the same roots the run did.
     */
    static final class Shell {

        private Shell() {
        }

        /** The only variables a finalization step is given on purpose. */
        static final List<String> FORWARDED = List.of("SELLEROPS_EVAL_STORE", "SELLEROPS_EVAL_CACHE");

        record Result(int exit, String stdout, String stderr) {
            boolean ok() {
                return exit == 0;
            }

            /** The last useful line, for a report. Bounded, because a report is read by a person. */
            String tail() {
                String text = (stdout + "\n" + stderr).strip();
                if (text.isEmpty()) {
                    return "(no output)";
                }
                return text.length() <= 400 ? text : text.substring(text.length() - 400);
            }
        }

        static Result run(Path workingDir, Map<String, String> env, String... command) {
            try {
                ProcessBuilder builder = new ProcessBuilder(command).directory(workingDir.toFile());
                for (String name : FORWARDED) {
                    String value = env == null ? null : env.get(name);
                    if (value != null && !value.isBlank()) {
                        builder.environment().put(name, value);
                    }
                }
                builder.environment().remove(GoalRunLauncher.CREDENTIAL_ENV);
                Process process = builder.start();
                String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
                return new Result(process.waitFor(), stdout, stderr);
            } catch (Exception e) {
                return new Result(-1, "", String.valueOf(e.getMessage()));
            }
        }
    }

    /** The step outcomes as a map, for the report. */
    static Map<String, String> asMap(List<Step> steps) {
        Map<String, String> m = new LinkedHashMap<>();
        steps.forEach(s -> m.put(s.name(), (s.ok() ? "ok — " : "FAILED — ") + s.detail()));
        return m;
    }
}
