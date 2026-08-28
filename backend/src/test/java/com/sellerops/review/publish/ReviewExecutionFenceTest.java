package com.sellerops.review.publish;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Structural fences for review-reply execution (Agentic Operating Workspace v2 §13–§14).
 */
class ReviewExecutionFenceTest {

    private static String stripped(String path) throws IOException {
        return Files.readString(Path.of(path)).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    @Test
    @DisplayName("the comment client posts once and never loops or retries a write")
    void noRetryLoopAroundTheWrite() throws IOException {
        String code = stripped("src/main/java/com/sellerops/review/publish/cafe24/Cafe24ReviewCommentClient.java");
        assertThat(code.split("postJson\\(", -1).length - 1).isEqualTo(1);
        // No loop around the write: a RETRYABLE outcome is a *classification* the service records, never a loop here.
        assertThat(code).doesNotContain("for (int attempt").doesNotContain("while (").doesNotContain("Thread.sleep");
    }

    @Test
    @DisplayName("the per-comment password is generated, used once and never persisted or logged")
    void passwordIsEphemeral() throws IOException {
        String pw = stripped("src/main/java/com/sellerops/review/publish/cafe24/Cafe24CommentPassword.java");
        assertThat(pw).doesNotContain("save(").doesNotContain("log.").doesNotContain("Repository");
        String adapter = stripped("src/main/java/com/sellerops/review/publish/cafe24/Cafe24ReviewCommentAdapter.java");
        // Minted inline into the one request; never held in a field or a local.
        assertThat(adapter.split("Cafe24CommentPassword\\.fresh\\(\\)", -1).length - 1).isEqualTo(1);
        assertThat(adapter).doesNotContainPattern("String\\s+password").doesNotContain("password =");
        String service = stripped("src/main/java/com/sellerops/review/publish/ReviewReplyExecutionService.java");
        assertThat(service).doesNotContain("password");
    }

    @Test
    @DisplayName("Answer Memory never reads a review execution — nothing below VERIFIED can become a remembered answer")
    void answerMemoryDoesNotReadReviewExecution() throws IOException {
        try (Stream<Path> files = Files.walk(Path.of("src/main/java/com/sellerops"))) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String name = p.getFileName().toString();
                if (!name.contains("AnswerMemory") && !p.toString().contains("/memory/")) continue;
                assertThat(Files.readString(p)).as(p.toString())
                        .doesNotContain("ReviewReplyExecution").doesNotContain("review_reply_execution");
            }
        }
    }
}
