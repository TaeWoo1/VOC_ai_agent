package com.sellerops.opportunity;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What the Opportunity Engine is not allowed to do</b> — asserted on the source, because every
 * property here is an absence.
 *
 * <p>An opportunity is a suggestion about where the seller can act, derived from evidence the product
 * already holds. What keeps it honest is that the code has no way to reach a marketplace, no way to
 * approve or send anything, no model to invent a cause with, and no writer into the knowledge library
 * — the draft it prepares leaves this package only through the seller's own hand.
 */
class OpportunitySafetyFenceTest {

    private static final Path PACKAGE = Paths.get("src/main/java/com/sellerops/opportunity");

    @Test
    @DisplayName("nothing in the opportunity package can reach a marketplace")
    void itTalksToNoChannel() throws IOException {
        List<String> forbidden = List.of(
                "HttpClient", "HttpRequest", "RestTemplate", "WebClient", "postForm",
                "Cafe24", "NaverCommerce", "Coupang", "connector.", "SellerAccount");
        assertAbsent(forbidden, "an opportunity is derived from what was already collected");
    }

    @Test
    @DisplayName("nothing here can approve, mint an action, execute, or publish")
    void itCrossesNoApprovalBoundary() throws IOException {
        List<String> forbidden = List.of(
                "InquiryApproval", "ApprovalService", "ActionIntent", "PublishExecution", "ReplyPublish",
                "ActionExecutor", "approvalId", "commandId", "submissionRef", "ReviewReplyApproval");
        assertAbsent(forbidden, "a prepared draft stops one step before every send path");
    }

    @Test
    @DisplayName("no model writes any sentence a seller reads here")
    void itCallsNoModel() throws IOException {
        List<String> forbidden = List.of("AgentLlm", "ChatModel", "OpenAi", "prompt", "Prompt", "embedding", "Embedding");
        assertAbsent(forbidden, "every sentence is composed from facts and the seller's own passages");
    }

    @Test
    @DisplayName("the package cannot write into the knowledge library — saving a draft as knowledge is the seller's decision, through the existing seam")
    void itWritesNoKnowledge() throws IOException {
        List<String> forbidden = List.of(
                "ProductKnowledgeLibraryService", "SellerOperationsKnowledgeService", "KnowledgeCandidate",
                "ProductKnowledgeIndexer", "KnowledgeSourceRequest", "OrgKnowledgeRequest", "AnswerMemory");
        assertAbsent(forbidden, "the draft reaches the library only through the quick-add the seller presses");
        // And the only repositories this package may SAVE to are its own two: the seller's decision
        // and the trail of how it got there. Both are named, and the counts must add up — a third
        // writer would show as a `.save(` this arithmetic cannot account for.
        for (Path source : javaFiles()) {
            String text = code(source);
            if (text.contains(".save(")) {
                assertThat(source.getFileName().toString()).isEqualTo("OpportunityService.java");
                assertThat(text).contains("decisions.save(").contains("trail.save(");
                assertThat(occurrences(text, ".save("))
                        .isEqualTo(occurrences(text, "decisions.save(") + occurrences(text, "trail.save("));
            }
        }
    }

    @Test
    @DisplayName("nothing here can delete a decision or a trail row — a seller cannot erase their own decision history by pressing a button")
    void itDeletesNothing() throws IOException {
        // Restore used to delete the decision row. Once the trail hangs off that row, deleting it
        // takes the history with it, so 되돌리기 became a way to erase the record of having decided.
        // Restore now moves the row to OPEN instead, and this is the guard that keeps it that way.
        assertAbsent(List.of(".delete(", ".deleteAll", "deleteBy"),
                "a decision can be taken back; it cannot be unhappened");
    }

    private static int occurrences(String text, String needle) {
        int n = 0;
        for (int i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length())) {
            n++;
        }
        return n;
    }

    @Test
    @DisplayName("the decision table and its trail exist as migrations")
    void migrationExists() {
        assertThat(Files.exists(Paths.get("src/main/resources/db/migration/V94__improvement_opportunity.sql"))).isTrue();
        assertThat(Files.exists(Paths.get(
                "src/main/resources/db/migration/V103__improvement_opportunity_decision_trail.sql"))).isTrue();
    }

    private static void assertAbsent(List<String> forbidden, String because) throws IOException {
        for (Path source : javaFiles()) {
            String text = code(source);
            for (String name : forbidden) {
                assertThat(text).as("%s: %s", source.getFileName(), because).doesNotContain(name);
            }
        }
    }

    private static List<Path> javaFiles() throws IOException {
        try (Stream<Path> walk = Files.walk(PACKAGE)) {
            return walk.filter(p -> p.toString().endsWith(".java")).toList();
        }
    }

    /** Source with comments stripped: a guard that fails on its own explanation gets deleted, not fixed. */
    private static String code(Path source) throws IOException {
        return Files.readString(source)
                .replaceAll("(?s)/\\*.*?\\*/", "")
                .replaceAll("(?m)//.*$", "");
    }
}
