package com.sellerops.common;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/**
 * The backend side of the {@code review-body-fingerprint/v1} cross-language proof. It loads the SAME
 * {@code contracts/review-fingerprint/v1/golden-vectors.json} that the collector's
 * {@code review-body-fingerprint.test.ts} loads; both passing is the equivalence guarantee. All vectors are
 * SYNTHETIC — no real PII.
 */
class ReviewBodyFingerprintTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static Path locateVectors() {
        Path dir = Paths.get(System.getProperty("user.dir")).toAbsolutePath();
        for (int i = 0; i < 8 && dir != null; i++, dir = dir.getParent()) {
            Path candidate = dir.resolve("contracts/review-fingerprint/v1/golden-vectors.json");
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException(
                "golden-vectors.json not found from user.dir=" + System.getProperty("user.dir"));
    }

    private static JsonNode cases() throws Exception {
        JsonNode root = MAPPER.readTree(Files.readString(locateVectors()));
        assertThat(root.get("spec").asText()).isEqualTo("review-body-fingerprint/v1");
        return root.get("cases");
    }

    @TestFactory
    List<DynamicTest> reproducesEverySharedGoldenVector() throws Exception {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : cases()) {
            String name = c.get("name").asText();
            String raw = c.get("raw").asText();
            String normalized = c.get("normalized").asText();
            String fingerprint = c.get("fingerprint").asText();
            tests.add(DynamicTest.dynamicTest("normalize:" + name, () ->
                    assertThat(ReviewBodyFingerprint.normalizeForFingerprint(raw)).isEqualTo(normalized)));
            tests.add(DynamicTest.dynamicTest("fingerprint:" + name, () -> {
                assertThat(fingerprint).matches("[0-9a-f]{64}");
                assertThat(ReviewBodyFingerprint.of(raw)).isEqualTo(fingerprint);
            }));
        }
        assertThat(tests).hasSizeGreaterThanOrEqualTo(16);
        return tests;
    }

    @Test
    void piiCaseTokenizesVolatileSpansAndLeaksNoRawSpan() throws Exception {
        JsonNode pii = null;
        for (JsonNode c : cases()) {
            if (c.get("name").asText().equals("pii-body")) {
                pii = c;
            }
        }
        assertThat(pii).isNotNull();
        String norm = ReviewBodyFingerprint.normalizeForFingerprint(pii.get("raw").asText());
        assertThat(norm)
                .contains("[링크]", "[이메일]", "[전화번호]", "[번호]")
                .doesNotContain("naver.me", "hong@test.com", "010-1234-5678", "02-345-6789", "1234567890");
    }

    @Test
    void nullAndBlankAreSafe() {
        assertThat(ReviewBodyFingerprint.normalizeForFingerprint(null)).isEmpty();
        assertThat(ReviewBodyFingerprint.of("")).matches("[0-9a-f]{64}");
    }
}
