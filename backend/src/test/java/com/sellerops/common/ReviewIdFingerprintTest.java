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
 * The backend side of the {@code review-id-fingerprint/v1} cross-language proof. It loads the SAME
 * {@code contracts/review-id-fingerprint/v1/golden-vectors.json} that the collector's Node port and its
 * in-page (browser) port load; all three passing is the equivalence guarantee that makes an identity match
 * across sources mean anything. All vectors are SYNTHETIC — never a real seller review id.
 */
class ReviewIdFingerprintTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static Path locateVectors() {
        Path dir = Paths.get(System.getProperty("user.dir")).toAbsolutePath();
        for (int i = 0; i < 8 && dir != null; i++, dir = dir.getParent()) {
            Path candidate = dir.resolve("contracts/review-id-fingerprint/v1/golden-vectors.json");
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException(
                "golden-vectors.json not found from user.dir=" + System.getProperty("user.dir"));
    }

    private static JsonNode cases() throws Exception {
        JsonNode root = MAPPER.readTree(Files.readString(locateVectors()));
        assertThat(root.get("spec").asText()).isEqualTo("review-id-fingerprint/v1");
        return root.get("cases");
    }

    @TestFactory
    List<DynamicTest> reproducesEverySharedGoldenVector() throws Exception {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : cases()) {
            String name = c.get("name").asText();
            String raw = c.get("raw").asText();
            String canonical = c.get("canonical").asText();
            boolean wellFormed = c.get("wellFormed").asBoolean();
            JsonNode fingerprint = c.get("fingerprint");
            tests.add(DynamicTest.dynamicTest("canonicalize:" + name, () ->
                    assertThat(ReviewIdFingerprint.canonicalize(raw)).isEqualTo(canonical)));
            tests.add(DynamicTest.dynamicTest("wellFormed:" + name, () ->
                    assertThat(ReviewIdFingerprint.isWellFormed(ReviewIdFingerprint.canonicalize(raw)))
                            .isEqualTo(wellFormed)));
            tests.add(DynamicTest.dynamicTest("fingerprint:" + name, () -> {
                if (fingerprint.isNull()) {
                    assertThat(ReviewIdFingerprint.of(raw)).isNull();
                } else {
                    assertThat(fingerprint.asText()).matches("[0-9a-f]{64}");
                    assertThat(ReviewIdFingerprint.of(raw)).isEqualTo(fingerprint.asText());
                }
            }));
        }
        assertThat(tests).hasSizeGreaterThanOrEqualTo(36);
        return tests;
    }

    @Test
    void aMalformedIdNeverProducesADigest() {
        assertThat(ReviewIdFingerprint.of(null)).isNull();
        assertThat(ReviewIdFingerprint.of("")).isNull();
        assertThat(ReviewIdFingerprint.of("   ")).isNull();
        assertThat(ReviewIdFingerprint.of("123 456")).isNull();
        assertThat(ReviewIdFingerprint.of("1".repeat(ReviewIdFingerprint.MAX_LENGTH + 1))).isNull();
        assertThat(ReviewIdFingerprint.of("1".repeat(ReviewIdFingerprint.MAX_LENGTH))).isNotNull();
    }

    @Test
    void isDomainSeparatedFromTheBodyFingerprint() {
        String same = "1234567890";
        assertThat(ReviewIdFingerprint.of(same)).isNotEqualTo(ReviewBodyFingerprint.of(same));
    }

    @Test
    void paddingAndZeroWidthDoNotChangeIdentity() {
        String digest = ReviewIdFingerprint.of("1234567890");
        assertThat(ReviewIdFingerprint.of("  1234567890  ")).isEqualTo(digest);
        assertThat(ReviewIdFingerprint.of("　1234567890　")).isEqualTo(digest);
        assertThat(ReviewIdFingerprint.of("﻿12345​67890")).isEqualTo(digest);
    }
}
