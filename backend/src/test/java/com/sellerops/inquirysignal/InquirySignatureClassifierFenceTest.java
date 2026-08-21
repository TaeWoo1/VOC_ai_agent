package com.sellerops.inquirysignal;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * One classifier in {@code main}, and it is the LLM one.
 *
 * <p>The reason mirrors the planner fence: a deterministic sibling implementation could answer for the
 * semantic classifier and a deployment would believe it had semantic detection while a keyword list
 * ran. That failure has a measured precedent — the deterministic extractor produced 0 signatures on
 * 3,220 real inquiries while every pipeline around it reported success.
 *
 * <p>Test doubles are exempt by construction: this scans {@code src/main} only, and
 * {@link StubInquirySignatureClassifier} lives in {@code src/test}.
 */
class InquirySignatureClassifierFenceTest {

    private static final Path MAIN = Paths.get("src/main/java/com/sellerops");

    @Test
    @DisplayName("exactly one InquirySignatureClassifier implementation exists in main")
    void exactlyOneImplementation() throws IOException {
        List<String> implementers = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String code = Files.readString(source);
                if (code.matches("(?s).*class\\s+\\w+\\s+implements\\s+InquirySignatureClassifier\\b.*")) {
                    implementers.add(source.getFileName().toString());
                }
            }
        }
        assertThat(implementers)
                .as("a deterministic sibling would answer for the model and nobody would notice")
                .containsExactly("LlmInquirySignatureClassifier.java");
    }
}
