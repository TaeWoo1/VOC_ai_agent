package com.sellerops.product.library;

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
 * What writing an answer basis may and may not do — asserted over the source, not over a run.
 *
 * <p><b>The one that matters is G.</b> A seller's reply and an objective fact about their product are
 * different claims: the reply is what was right for this customer today, with their order, their
 * tone and their exception in it. Promoting it to knowledge would put that exception in front of the
 * next customer as a rule the seller never wrote. There is an explicit place for the seller to say
 * 「이 답변을 답변 기준으로 저장」 later; until they can say it, nothing may decide it for them.
 */
class KnowledgeWriteFenceTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");

    /**
     * The classes allowed to create a knowledge document.
     *
     * <p>Three, and each one is a person's decision or a read of the seller's own listing: the
     * library editor (they typed it), the 상세페이지 text lane (they wrote it on their listing), and
     * the image lane (a model read it off that same listing, and it is stamped as such).
     */
    private static final List<String> ALLOWED_WRITERS = List.of(
            "ProductKnowledgeLibraryService.java",
            "ProductDetailEnrichment.java",
            "ProductDetailImageKnowledge.java",
            // Knowledge Sources & Acquisition v1 adds two, and both are the same KIND of thing the
            // three above are — a person's decision, made on purpose, in a place that is about
            // knowledge rather than about answering a customer:
            //   the seller handed over a file and said it is their material (the upload);
            //   the seller read a candidate and pressed 확인 (the inbox).
            // Neither is reachable from a reply, an approval or an execution — asserted below, so this
            // list getting longer cannot quietly become this list meaning less.
            "KnowledgeDocumentService.java",
            "KnowledgeCandidateService.java");

    private static String executable(Path source) throws IOException {
        return Files.readString(source).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    @Test
    @DisplayName("G — no reply, approval or execution path can create a knowledge document")
    void anAnswerIsNotAutomaticallyKnowledge() throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(f -> f.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (ALLOWED_WRITERS.contains(name)) {
                    continue;
                }
                String code = executable(source);
                if (code.contains("new ProductKnowledgeSource()")
                        || code.contains("ProductKnowledgeSource::new")) {
                    offenders.add(name);
                }
            }
        }
        assertThat(offenders)
                .as("a sentence a seller sent is not a fact about the product; promoting it is a decision")
                .isEmpty();
    }

    @Test
    @DisplayName("G — the two acquisition writers are seller decisions, not answer paths")
    void theAcquisitionWritersAreNotAnswerPaths() throws IOException {
        // A document is written by an upload; a candidate becomes knowledge only in accept(). What must
        // stay impossible is either of them writing knowledge because an ANSWER happened, so neither may
        // name a draft, an approval, an execution or the memory writer.
        for (String name : List.of("KnowledgeDocumentService.java", "KnowledgeCandidateService.java")) {
            Path source;
            try (Stream<Path> walk = Files.walk(MAIN)) {
                source = walk.filter(f -> f.getFileName().toString().equals(name)).findFirst().orElseThrow();
            }
            String code = executable(source);
            for (String forbidden : List.of("ReplyDraft", "Approval", "Execution", "remember(",
                    "AnswerMemoryService", "publish", "submission")) {
                assertThat(code)
                        .as("%s must not be reachable from an answer path (%s)", name, forbidden)
                        .doesNotContain(forbidden);
            }
        }
        // The candidate writer reads Answer Memory to COUNT sentences, and that read is the repository
        // rather than the service: counting what a seller has said is not remembering something new.
        Path candidate;
        try (Stream<Path> walk = Files.walk(MAIN)) {
            candidate = walk.filter(f -> f.getFileName().toString().equals("KnowledgeCandidateService.java"))
                    .findFirst().orElseThrow();
        }
        assertThat(executable(candidate)).contains("AnswerMemoryRepository");
    }

    @Test
    @DisplayName("G — the inquiry reply packages never reach the product knowledge writer")
    void theReplyLifecycleHoldsNoKnowledgeWriter() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (String pkg : List.of("inquiry/reply", "inquiry/publish", "inquiry/proposal",
                "inquiry/lifecycle")) {
            Path dir = MAIN.resolve(pkg);
            if (!Files.isDirectory(dir)) {
                continue;
            }
            try (Stream<Path> walk = Files.walk(dir)) {
                for (Path source : walk.filter(f -> f.toString().endsWith(".java")).toList()) {
                    String code = executable(source);
                    if (code.contains("ProductKnowledgeLibraryService")
                            || code.contains("ProductKnowledgeSourceRepository")
                            || code.contains("ProductKnowledgeIndexer")) {
                        offenders.add(source.getFileName().toString());
                    }
                }
            }
        }
        assertThat(offenders).as("approving and sending a reply must leave the library untouched")
                .isEmpty();
    }

    @Test
    @DisplayName("H — saving an answer basis reaches no channel: the library package holds no connector")
    void savingKnowledgeTouchesNoMarketplace() throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN.resolve("product/library"))) {
            for (Path source : walk.filter(f -> f.toString().endsWith(".java")).toList()) {
                String code = executable(source);
                for (String forbidden : List.of("com.sellerops.connector", "HttpClient", "RestTemplate",
                        "WebClient", "ActionIntent", "ActionExecutor")) {
                    if (code.contains(forbidden)) {
                        offenders.add(source.getFileName().toString() + ":" + forbidden);
                    }
                }
            }
        }
        assertThat(offenders).as("a seller writing a sentence about their product is a local write")
                .isEmpty();
    }

    @Test
    @DisplayName("I — neither 상세페이지 lane is on by default; this package added no model call")
    void theImageLaneStaysOff() throws IOException {
        String yaml = Files.readString(Path.of("src", "main", "resources", "application.yml"));
        assertThat(yaml).contains("SELLEROPS_IMAGE_KNOWLEDGE_ENABLED:false");
        assertThat(yaml).contains("SELLEROPS_PRODUCT_DETAIL_ENRICHMENT_ENABLED:false");

        // And the loop's own classes cannot start one: the quick-add path is the library service.
        String library = executable(MAIN.resolve("product/library/ProductKnowledgeLibraryService.java"));
        for (String vendor : List.of("AgentLlmTransport", "AgentDraftService", "LlmHttpClient",
                "ImageFactExtraction", "ProductDetailImageKnowledge")) {
            assertThat(library).as("%s has no business in a save", vendor).doesNotContain(vendor);
        }
    }
}
