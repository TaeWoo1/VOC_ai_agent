package com.sellerops.inquiry.goal;

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
 * <b>The Resolution Planner stays readable and stays unreachable</b> (Inquiry v3.5 §0, §15).
 *
 * <p>Two properties, and they are opposites on purpose. The planner is <b>kept</b> — its types, its prompt, its
 * validator and every run recorded against it are comparison and replay assets, and deleting them would make the
 * WP-1..WP-3.2 evidence unreadable. And it is <b>not adopted</b> — no production code may call it.
 *
 * <p>That second property is not a plan for later: it is already true, and this test is what keeps it true. The
 * migration note in §15 says each phase leaves the planner in place; this is the guard that makes "in place" mean
 * "beside production" rather than "in production". A status written only in a document is a status nobody checks.
 */
class LegacyPlannerStatusTest {

    private static final Path MAIN = Path.of("src", "main", "java");
    private static final Path PLANNER = MAIN.resolve(Path.of("com", "sellerops", "inquiry", "resolution"));

    @Test
    @DisplayName("every legacy planner type carries its status where a reader of the code will see it")
    void statusIsInTheCode() throws IOException {
        List<Path> types = files(PLANNER);
        assertThat(types).as("the planner's types are kept, not deleted").hasSize(4);
        for (Path p : types) {
            assertThat(Files.readString(p))
                    .as("%s does not say it was not adopted", p.getFileName())
                    .contains("NOT_ADOPTED_FOR_PRODUCTION");
        }
    }

    @Test
    @DisplayName("no production code calls the planner — the one seam that could is package-private and test-only")
    void noProductionCaller() throws IOException {
        List<String> callers = new ArrayList<>();
        for (Path p : files(MAIN)) {
            if (p.startsWith(PLANNER)) {
                continue;
            }
            String src = Files.readString(p);
            if (src.contains("ResolutionPlanParser.parse(") || src.contains("ResolutionPlannerPrompt.system(")
                    || src.contains("ResolutionPlanValidator.")) {
                callers.add(p.getFileName().toString());
            }
        }
        // InquiryDecisionGenerator holds the harness seam that builds and parses a planner call. It is reached only
        // from src/test; nothing in a request path reaches it, and nothing else in main names these types at all.
        assertThat(callers).containsExactly("InquiryDecisionGenerator.java");

        String seam = Files.readString(MAIN.resolve(Path.of("com", "sellerops", "inquiry", "decision",
                "InquiryDecisionGenerator.java")));
        assertThat(seam).as("the seam stays package-private: a public one is a production path waiting to be used")
                .contains("    ResolutionPlanCall resolutionPlan(")
                .doesNotContain("public ResolutionPlanCall resolutionPlan(");
    }

    @Test
    @DisplayName("the replacement does not name the thing it replaces")
    void theNewPathDoesNotDependOnTheOldOne() throws IOException {
        for (Path p : files(MAIN.resolve(Path.of("com", "sellerops", "inquiry", "goal")))) {
            assertThat(Files.readString(p).replaceAll("(?s)/\\*.*?\\*/", ""))
                    .as("%s imports the planner; the two are supposed to be separable", p.getFileName())
                    .doesNotContain("inquiry.resolution");
        }
    }

    private static List<Path> files(Path root) throws IOException {
        try (Stream<Path> s = Files.walk(root)) {
            return s.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
    }
}
