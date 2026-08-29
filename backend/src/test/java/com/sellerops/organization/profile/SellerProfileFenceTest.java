package com.sellerops.organization.profile;

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
 * Seller Context v1-B — what the company profile cannot be, asserted on the source.
 *
 * <p>Three absences: <b>seller-authored only</b> (no class outside the settings package writes a
 * profile — no model, no proactive tick, no draft path), <b>context, never evidence</b> (the answer
 * basis and the retrieval never read it, so a summary alone can never ground a claim), and
 * <b>never a system instruction</b> (the text is rendered only into the user turn's labelled
 * section). Each would be easy to break by accident and invisible in a green suite.
 */
class SellerProfileFenceTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");
    private static final Path PROFILE = MAIN.resolve("organization").resolve("profile");

    private static String executable(Path source) throws IOException {
        return Files.readString(source).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    private static List<Path> javaIn(Path dir) throws IOException {
        try (Stream<Path> walk = Files.walk(dir)) {
            return walk.filter(f -> f.toString().endsWith(".java")).toList();
        }
    }

    @Test
    @DisplayName("seller-authored only: the profile repository and save() are reached from the profile package alone")
    void onlyTheSettingsPackageWritesAProfile() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path source : javaIn(MAIN)) {
            if (source.startsWith(PROFILE)) {
                continue;
            }
            String code = executable(source);
            if (code.contains("OrganizationProfileRepository") || code.contains("OrganizationProfile ")
                    || code.contains("profiles.save(") && code.contains("SellerProfile")) {
                offenders.add(source.getFileName().toString());
            }
        }
        assertThat(offenders).as("no model, tick or draft path may write the company's description").isEmpty();
    }

    @Test
    @DisplayName("the profile package holds no model client, no connector and no draft/memory reader")
    void theProfilePackageIsStorageOnly() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path source : javaIn(PROFILE)) {
            String code = executable(source);
            for (String forbidden : List.of("AgentDraftGenerator", "AgentLlmTransport", "AgentDraftService",
                    "anthropic", "openai", "connector", "ActionExecutor", "HttpClient", "WebClient",
                    "RestTemplate", "AnswerMemory", "InquiryReplyDraft", "ProactiveCase", "Retriever")) {
                if (code.contains(forbidden)) {
                    offenders.add(source.getFileName() + " -> " + forbidden);
                }
            }
        }
        assertThat(offenders).isEmpty();
    }

    @Test
    @DisplayName("context, never evidence: the basis verdict and the retrieval do not read the profile")
    void theBasisNeverSeesTheProfile() throws IOException {
        Path draft = MAIN.resolve("inquiry").resolve("draft");
        for (String file : List.of("AnswerBasisState.java", "InquiryEvidenceRetriever.java",
                "DraftKnowledgeState.java", "SpecApplicability.java")) {
            String code = executable(draft.resolve(file));
            assertThat(code).as("%s must decide with no knowledge of the company profile", file)
                    .doesNotContain("SellerProfile")
                    .doesNotContain("companyContext")
                    .doesNotContain("businessSummary");
        }
        // And in the composer it is read AFTER the verdict, on the model path only.
        String composer = executable(draft.resolve("InquiryDraftComposer.java"));
        assertThat(composer.indexOf("AnswerBasisState.of(")).isLessThan(composer.indexOf("companyContextFor(orgId)"));
    }

    @Test
    @DisplayName("never a system instruction: the prompt renders the profile into the user turn only")
    void theProfileIsUserTurnDataOnly() throws IOException {
        String prompt = executable(MAIN.resolve("agent").resolve("llm").resolve("AgentDraftPrompt.java"));
        int systemStart = prompt.indexOf("public static String system()");
        int systemEnd = prompt.indexOf("public static String user(");
        assertThat(systemStart).isPositive();
        assertThat(prompt.substring(systemStart, systemEnd)).doesNotContain("companyContext");
    }
}
