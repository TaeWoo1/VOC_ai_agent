package com.sellerops.knowledge.style;

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
 * What a style setting cannot reach, asserted on the source rather than on intent.
 *
 * <p>Three of this package's regressions are absences, and an absence is only checkable by naming
 * the thing that must not be there: <b>I</b> a style save reaches no marketplace, <b>J</b> nothing
 * learns a style from past answers, <b>K</b> a review reply is not written in the inquiry style.
 * Each of them would be easy to break by accident and impossible to notice in a green suite.
 */
class AnswerStyleFenceTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");
    private static final Path STYLE = MAIN.resolve("knowledge").resolve("style");

    private static String executable(Path source) throws IOException {
        return Files.readString(source).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    private static List<Path> javaIn(Path dir) throws IOException {
        try (Stream<Path> walk = Files.walk(dir)) {
            return walk.filter(f -> f.toString().endsWith(".java")).toList();
        }
    }

    // ---------------------------------------------------------------- I

    @Test
    @DisplayName("I — saving a style cannot reach a channel: no connector, no executor, no HTTP client")
    void theStylePackageCannotReachAMarketplace() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path source : javaIn(STYLE)) {
            String code = executable(source);
            for (String forbidden : List.of("connector", "ActionExecutor", "HttpClient", "WebClient",
                    "RestTemplate", "ActionWindow", "InquiryAnswerAdapter", "publish")) {
                if (code.contains(forbidden)) {
                    offenders.add(source.getFileName() + " -> " + forbidden);
                }
            }
        }
        assertThat(offenders).as("a wording preference is not a reason to touch a seller's channel")
                .isEmpty();
    }

    @Test
    @DisplayName("I — and it holds no model client either: a style is stored, never generated")
    void theStylePackageCallsNoModel() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path source : javaIn(STYLE)) {
            String code = executable(source);
            for (String forbidden : List.of("AgentDraftGenerator", "AgentLlmTransport",
                    "ImageFactExtraction", "anthropic", "openai", "x-api-key")) {
                if (code.contains(forbidden)) {
                    offenders.add(source.getFileName() + " -> " + forbidden);
                }
            }
        }
        assertThat(offenders).isEmpty();
    }

    // ---------------------------------------------------------------- J

    @Test
    @DisplayName("J — nothing learns a style: no past answer, memory or draft is read to write one")
    void aStyleIsTypedByAPersonOrItDoesNotExist() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path source : javaIn(STYLE)) {
            String code = executable(source);
            for (String forbidden : List.of("AnswerMemory", "InquiryReplyDraft", "ReplyDraftRepository",
                    "ExemplarService", "learn")) {
                if (code.contains(forbidden)) {
                    offenders.add(source.getFileName() + " -> " + forbidden);
                }
            }
        }
        assertThat(offenders)
                .as("「보낸 답변」과 「좋은 답변」은 다르다 — v1 does not infer one from the other")
                .isEmpty();
    }

    @Test
    @DisplayName("J — the exemplar gate exists and still has no caller: candidacy is not candidacy yet")
    void theExemplarGateIsDeclaredAndUnused() throws IOException {
        List<String> callers = new ArrayList<>();
        for (Path source : javaIn(MAIN)) {
            if (source.getFileName().toString().equals("AnswerStyleSafetyFloor.java")) {
                continue;
            }
            if (executable(source).contains("usableAsExemplar")) {
                callers.add(source.getFileName().toString());
            }
        }
        assertThat(callers).as("exemplars are a later package; this method is a promise, not a feature")
                .isEmpty();
    }

    // ---------------------------------------------------------------- K

    @Test
    @DisplayName("K — a review reply is not written in the inquiry answer style")
    void reviewRepliesAreUntouched() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path source : javaIn(MAIN.resolve("review"))) {
            String code = executable(source);
            if (code.contains("AnswerStyleProfile") || code.contains("AnswerStyleService")
                    || code.contains("AnswerStyleInstruction")) {
                offenders.add(source.getFileName().toString());
            }
        }
        assertThat(offenders)
                .as("리뷰 답글과 문의 답변은 다른 글이다 — v1 says so by not reaching across")
                .isEmpty();
    }

    // ---------------------------------------------------------------- the floor is wired now

    @Test
    @DisplayName("the safety floor has a production caller at last — and exactly one")
    void theFloorIsEnforcedSomewhere() throws IOException {
        List<String> referrers = new ArrayList<>();
        for (Path source : javaIn(MAIN)) {
            if (source.getFileName().toString().equals("AnswerStyleSafetyFloor.java")) {
                continue;
            }
            if (executable(source).contains("AnswerStyleSafetyFloor")) {
                referrers.add(source.getFileName().toString());
            }
        }
        // It was written a package ahead of its caller and asserted to have none. That assertion is
        // now the other way round: the floor runs where a style is SAVED, so a refusal is a message
        // the seller reads rather than a setting that silently does nothing.
        assertThat(referrers).containsExactly("AnswerStyleService.java");
    }

    @Test
    @DisplayName("the seller's own strings never reach the system turn — only the user turn carries them")
    void styleTravelsInTheUserTurnOnly() throws IOException {
        String prompt = Files.readString(
                MAIN.resolve("agent").resolve("llm").resolve("AgentDraftPrompt.java"));
        String system = prompt.substring(prompt.indexOf("public static String system()"),
                prompt.indexOf("public static String user("));
        assertThat(system).as("the system turn is a constant over CATEGORIES and nothing else")
                .doesNotContain("style").doesNotContain("profile.")
                .doesNotContain("greeting").doesNotContain("closing");
        assertThat(system).as("and it states the precedence in words as well")
                .contains("규칙이 우선");
    }
}
