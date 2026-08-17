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

    // A stripper that also removed string literals lived here, so that a harness PRINTING the word
    // HOLDOUT could not trip a guard looking for a code path to one. It is gone with the assertion
    // that needed it — every check below matches on a literal, and searching source with the
    // literals removed is how a guard passes because it looked in the wrong place.

    /**
     * The candidate-iteration harness reads one corpus, and it is the spent one.
     *
     * <p><b>This guard was rewritten on 2026-08-17 and the rewrite is the point.</b> It used to
     * assert the development harness had no path to a {@code HOLDOUT} row. That was the right
     * boundary while the v2 holdout was unspent; RUBRIC v2 §12 then made all 220 rows development
     * evidence, so the old assertion would now be forbidding something the contract permits — and a
     * guard that fails on the permitted thing gets deleted rather than fixed.
     *
     * <p>The constraint <b>moved</b> rather than went away. What must stay unreachable is the
     * <i>fresh</i> sample §13 designs, which is the one that will actually verify a candidate. So:
     * one corpus directory constant, pointing at {@code v2}, and no spend flag of any kind.
     */
    @Test
    @DisplayName("the development harness reads only the spent v2 corpus, and no spend flag")
    void theDevHarnessReadsOnlyTheSpentCorpus() throws IOException {
        String code = stripComments(Files.readString(LLM_EVAL));

        assertThat(code.split("Path\\.of\\(\"\\.\\.\", \"contracts\"", -1).length - 1)
                .as("exactly one corpus directory, so there is one place to check").isEqualTo(1);
        assertThat(code).as("and it is the v2 corpus, whose holdout is already spent")
                .contains("Path.of(\"..\", \"contracts\", \"review-eval\", \"naver\", \"v2\")");
        assertThat(code).as("no spend flag — this harness is re-run on every prompt edit")
                .doesNotContain("SPEND_HOLDOUT");
        assertThat(code).as("the split is still computed, for the §12.2 provenance column")
                .contains("splitOf");
        assertThat(code).as("but it selects nothing any more")
                .doesNotContain("\"DEV\".equals(CalibrationSample.splitOf");
    }

    /**
     * §8.10.1's "never again" is a file on disk, not a sentence in a contract.
     *
     * <p>The v2 holdout was read once, on 2026-08-17, and candidate B was rejected on it. §12.3 seals
     * it with {@code holdout-spent.json}: while that file exists both harnesses that can score a
     * holdout row return without reading one. §8.9's reasoning about prompts applies to contracts
     * too — an instruction not to do something is a request, re-litigated by whoever next needs the
     * number to come out differently.
     */
    @Test
    @DisplayName("both holdout readers are sealed by holdout-spent.json")
    void theSpentHoldoutIsSealedByAFile() throws IOException {
        Path seal = Path.of("..", "contracts", "review-eval", "naver", "v2", "holdout-spent.json");
        assertThat(Files.exists(seal)).as("the seal exists and records what was spent").isTrue();
        assertThat(Files.readString(seal)).contains("REJECTED").contains("§8.10.1");

        Path evalDir = Path.of("src", "test", "java", "com", "sellerops", "review", "triage", "eval");
        for (String reader : List.of("ReviewTriageEvalIT.java", "LlmTriageHoldoutIT.java")) {
            assertThat(stripComments(Files.readString(evalDir.resolve(reader))))
                    .as("%s checks the seal before it can score a holdout row", reader)
                    .contains("holdout-spent.json");
        }
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
                // The classifier's own constructor — `new ApiTriageClassifier(` — and not its nested
                // Tuning record, which callers legitimately build to hand to the gate's factory.
                if (code.contains("new ApiTriageClassifier(") || code.contains(".classify(new Input")) {
                    offenders.add(name);
                }
                // The pilot service holds a gate, and may only obtain one from the gate's own factory.
                // A field of the classifier's type would be the direct hold this test forbids.
                if (name.equals("AiTriagePilotService.java")
                        && (code.contains("ApiTriageClassifier classifier") || code.contains("private final ApiTriageClassifier"))) {
                    offenders.add(name + " (holds the classifier directly)");
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
