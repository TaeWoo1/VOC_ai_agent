package com.sellerops.agent.llm;

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
 * The agent-draft twin of {@code ClassifierBoundaryTest}: boundaries that are true today by
 * construction, asserted so they stay true after the next edit.
 *
 * <p>Comments are stripped before scanning, because these files legitimately <i>discuss</i> the thing
 * they must not do, and a guard that failed on its own explanation gets deleted rather than fixed.
 */
class AgentDraftBoundaryTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");

    private static String stripComments(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    /**
     * Nothing in production reaches the vendor around the org allow-list.
     *
     * <p>{@link AgentDraftService} is the door — it is where {@code isEnabledFor(orgId)} is checked —
     * and this asserts it is the ONLY one, so a future service cannot hold an
     * {@link AgentDraftGenerator} directly and draft for an org that never opted in.
     */
    @Test
    @DisplayName("only AgentDraftService constructs the generator or holds the transport")
    void theServiceIsTheOnlyDoor() throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (name.equals("AgentDraftService.java") || name.equals("AgentDraftGenerator.java")) {
                    continue;
                }
                String code = stripComments(Files.readString(source));
                if (code.contains("new AgentDraftGenerator(") || code.contains("AgentDraftGenerator::new")) {
                    offenders.add(name + " (constructs the generator)");
                }
                // The transport may be DECLARED (the @Bean factory) but only the generator may call it.
                if (!name.equals("JdkAgentLlmTransport.java") && !name.equals("AgentLlmConfiguration.java")
                        && code.contains("AgentLlmTransport") && code.contains(".post(")) {
                    offenders.add(name + " (calls the transport directly)");
                }
            }
        }
        assertThat(offenders)
                .as("a caller holding the generator directly would be an allow-list nobody runs")
                .isEmpty();
    }

    /**
     * The two LLM capabilities stay separable.
     *
     * <p>They are different exposures — a review's rating and body vs an inquiry's title and body —
     * and the whole reason this package has its own transport, its own prompt, its own flag and its
     * own key is that a deployment must be able to run either without the other. A file that read the
     * triage key or the triage flag here would quietly re-merge them.
     */
    @Test
    @DisplayName("the draft capability never reads the triage pilot's key or flag")
    void theTwoCapabilitiesStaySeparable() throws IOException {
        Path dir = MAIN.resolve("agent").resolve("llm");
        try (Stream<Path> walk = Files.walk(dir)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String code = stripComments(Files.readString(source));
                assertThat(code).as("%s reads the triage flag", source.getFileName())
                        .doesNotContain("sellerops.triage.ai-pilot");
                assertThat(code).as("%s reads the triage transport", source.getFileName())
                        .doesNotContain("LlmHttpClient");
                assertThat(code).as("%s reads the triage classifier", source.getFileName())
                        .doesNotContain("ApiTriageClassifier");
            }
        }
    }

    /**
     * The capability is OFF unless a deployment turns it on, and it is off in three independent ways.
     *
     * <p>Asserted on the properties rather than on a comment, because "off by default" is the sentence
     * every unreviewed default is written under.
     */
    @Test
    @DisplayName("no flag, no key, or no org — all three mean off")
    void offByDefaultThreeWays() {
        java.util.UUID org = java.util.UUID.randomUUID();
        assertThat(props(false, org.toString(), "sk-key").isEnabledFor(org)).as("flag off").isFalse();
        assertThat(props(true, org.toString(), "").isEnabledFor(org)).as("no key").isFalse();
        assertThat(props(true, "", "sk-key").isEnabledFor(org)).as("org not listed").isFalse();
        assertThat(props(true, java.util.UUID.randomUUID().toString(), "sk-key").isEnabledFor(org))
                .as("a DIFFERENT org listed").isFalse();
        assertThat(props(true, org.toString(), "sk-key").isEnabledFor(org)).as("all three").isTrue();
        assertThat(props(true, "*", "sk-key").isEnabledFor(org)).as("the local single-user wildcard").isTrue();
        assertThat(props(true, "*", "sk-key").isEnabledFor(null)).as("but never for no org at all").isFalse();
    }

    private static AgentDraftProperties props(boolean enabled, String orgIds, String key) {
        return new AgentDraftProperties(enabled, orgIds, "OPENAI", "m", key, 4000, "low");
    }
}
