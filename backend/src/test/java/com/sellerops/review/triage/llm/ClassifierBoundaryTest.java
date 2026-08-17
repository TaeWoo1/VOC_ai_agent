package com.sellerops.review.triage.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Two boundaries that are true today by construction, asserted so they stay true after the next edit.
 *
 * <p>Both were checked by hand during the independent review of candidate B and both held. A property
 * verified once by reading is a property that lasts until someone changes the file, which is exactly
 * what {@code ReviewTriageQueueIsolationTest} exists to say about a different boundary — this is the
 * same move for this package.
 *
 * <p>Comments are stripped before scanning, because these files legitimately <i>discuss</i> the thing
 * they must not do, and a guard that failed on its own explanation gets deleted rather than fixed.
 */
class ClassifierBoundaryTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");
    private static final Path LLM_EVAL =
            Path.of("src", "test", "java", "com", "sellerops", "review", "triage", "eval",
                    "LlmTriageEvalIT.java");

    private static String stripComments(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    /**
     * Comments, text blocks and string literals removed — what is left is executable code.
     *
     * <p>Needed because the harness PRINTS the sentence "HOLDOUT was not read". A guard that could not
     * tell a code path from the report describing its absence would fail on the honest version and
     * pass on a silent one, which is precisely backwards.
     */
    private static String executableCode(String source) {
        return stripComments(source)
                .replaceAll("(?s)\"\"\".*?\"\"\"", "\"\"")
                .replaceAll("\"(\\\\.|[^\"\\\\])*\"", "\"\"");
    }

    /**
     * The candidate-iteration harness cannot spend the holdout.
     *
     * <p>RUBRIC v2 §6.2 gives the holdout one reading, spent by the FINAL candidate. A harness whose
     * whole purpose is to be re-run against successive candidates is the thing most likely to spend
     * it early — so it must not be able to, and the guarantee cannot be "nobody passed the flag".
     */
    @Test
    @DisplayName("the DEV harness has no code path that reads a HOLDOUT row")
    void theDevHarnessCannotReachTheHoldout() throws IOException {
        String source = Files.readString(LLM_EVAL);
        String code = executableCode(source);

        assertThat(code).as("no HOLDOUT branch, flag or env var in executable code")
                .doesNotContain("HOLDOUT");
        assertThat(code).as("the split IS read, so this guard is not vacuous").contains("splitOf");
        assertThat(code.split("splitOf", -1).length - 1)
                .as("exactly one place decides which half is scored").isEqualTo(1);
        // And that one place admits DEV only. Checked on the raw source, since the literal it
        // compares against is exactly what executableCode() strips.
        assertThat(stripComments(source))
                .contains("\"DEV\".equals(CalibrationSample.splitOf(row.fingerprint()))");
        assertThat(stripComments(source)).as("no env var could turn the holdout on")
                .doesNotContain("SPEND_HOLDOUT");
    }

    /**
     * Exactly one file may read the holdout for the LLM path, and it needs a flag with no other use.
     *
     * <p>The separation is the mechanism: {@link #theDevHarnessCannotReachTheHoldout} keeps the
     * re-run-constantly harness away from it, and this keeps the single-use one from multiplying. A
     * second holdout reader appearing would be how §6.2's one reading quietly becomes several.
     */
    @Test
    @DisplayName("only LlmTriageHoldoutIT reads the holdout, and only behind its own flag")
    void oneHoldoutReaderOnly() throws IOException {
        Path evalDir = Path.of("src", "test", "java", "com", "sellerops", "review", "triage", "eval");
        List<String> readers = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(evalDir)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                // stripComments, not executableCode: the flag's NAME is a string literal, which
                // executableCode() deliberately removes. Using it here found nothing at all, which
                // is the shape of a guard that passes because it looks in the wrong place.
                String code = stripComments(Files.readString(source));
                if (code.contains("SPEND_HOLDOUT")) {
                    readers.add(source.getFileName().toString());
                }
            }
        }
        // ReviewTriageEvalIT spends it for the rating-only rule; LlmTriageHoldoutIT for a candidate.
        assertThat(readers).containsExactlyInAnyOrder(
                "ReviewTriageEvalIT.java", "LlmTriageHoldoutIT.java");

        String holdout = stripComments(Files.readString(evalDir.resolve("LlmTriageHoldoutIT.java")));
        assertThat(holdout).as("the flag is checked, and returns without reading when unset")
                .contains("LLM_TRIAGE_SPEND_HOLDOUT");
    }

    /**
     * Nothing in production reaches the transport around the channel check.
     *
     * <p>RUBRIC v2 §8.3 opens NAVER triage and nothing else, and §8.4 requires the check sit at the
     * boundary rather than in a caller's memory. {@link NaverOnlyClassifierGate} is that boundary;
     * this asserts it is the only door, so a future service cannot hold an
     * {@link ApiTriageClassifier} directly and classify a Coupang review with it.
     */
    @Test
    @DisplayName("only the gate constructs or calls the API classifier in main")
    void theGateIsTheOnlyDoor() throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (name.equals("NaverOnlyClassifierGate.java") || name.equals("ApiTriageClassifier.java")) {
                    continue;
                }
                String code = stripComments(Files.readString(source));
                if (code.contains("new ApiTriageClassifier") || code.contains(".classify(new Input")) {
                    offenders.add(name);
                }
            }
        }
        assertThat(offenders)
                .as("a caller holding the classifier directly would be a channel check nobody runs")
                .isEmpty();
    }

    /**
     * The guard is not harness-only.
     *
     * <p>The defect this review found: {@link AdditiveTriageDecision} was applied in the evaluation
     * harness and nowhere else, while every stored prediction stamped {@code +additive-guard/v1} into
     * its version. A version string that asserts a property the row does not have is worse than one
     * that says nothing.
     */
    @Test
    @DisplayName("the additive guard is applied on the write path, not only in the harness")
    void theGuardRunsInProduction() throws IOException {
        List<String> callers = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                if (source.getFileName().toString().equals("AdditiveTriageDecision.java")) {
                    continue;
                }
                if (stripComments(Files.readString(source)).contains("AdditiveTriageDecision.decide(")) {
                    callers.add(source.getFileName().toString());
                }
            }
        }
        assertThat(callers)
                .as("something in main must actually apply the invariant its version advertises")
                .contains("TriageFeedbackService.java");
    }
}
