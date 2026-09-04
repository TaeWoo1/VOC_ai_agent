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
        // And the only repository this package may SAVE to is its own decision table.
        for (Path source : javaFiles()) {
            String text = code(source);
            if (text.contains(".save(")) {
                assertThat(source.getFileName().toString()).isEqualTo("OpportunityService.java");
                assertThat(text).contains("decisions.save(");
                assertThat(text.split("\\.save\\(").length - 1).isEqualTo(text.split("decisions\\.save\\(").length - 1);
            }
        }
    }

    @Test
    @DisplayName("the decision table exists as one migration")
    void migrationExists() {
        assertThat(Files.exists(Paths.get("src/main/resources/db/migration/V94__improvement_opportunity.sql"))).isTrue();
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
