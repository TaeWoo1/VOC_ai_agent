package com.sellerops.product.detail.image;

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
 * The new egress class, fenced the way the LLM capabilities are.
 *
 * <p>{@code AgentDraftBoundaryTest} keeps one door in front of each vendor call because a second
 * caller is an allow-list nobody runs. The same argument applies here and is arguably stronger: this
 * is the only client in the backend that fetches a URL it did not construct, with no credential. A
 * second holder of it would be a general-purpose URL fetcher, which is precisely what the approval
 * for this lane excludes.
 */
class DetailImageFetchBoundaryTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");

    /** The classes allowed to construct the fetcher. One, today: the Stage 0 census. */
    private static final List<String> ALLOWED_HOLDERS = List.of(
            "NaverConnectorConfiguration.java", "NaverDetailImageCensusRunner.java",
            // The image-knowledge lane, added 2026-08-27. It constructs the fetcher rather than
            // taking it as a bean on purpose: a container-wide DetailImageFetcher bean would make
            // credential-free arbitrary-URL egress available to every class in this backend, which
            // is precisely what this test exists to prevent. Two named holders, both bounded.
            "ProductDetailImageKnowledge.java",
            // The review-photo lane (Customer Ops Demo Closure v1, 2026-09-18). Same reasoning: it constructs its
            // own, and its only input is an address a channel observation stored on a review_media row — which
            // ReviewMediaWriter accepted only from the channel's image CDN.
            "ReviewMediaInspector.java",
            "DetailImageFetcher.java");

    private static String executable(Path source) throws IOException {
        return Files.readString(source).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    @Test
    @DisplayName("only the approved holders construct the fetcher — it is not a general URL client")
    void theFetcherHasOneDoor() throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(f -> f.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (ALLOWED_HOLDERS.contains(name)) {
                    continue;
                }
                String code = executable(source);
                if (code.contains("new DetailImageFetcher(") || code.contains("DetailImageFetcher::new")) {
                    offenders.add(name);
                }
            }
        }
        assertThat(offenders)
                .as("a second constructor of this is a general-purpose URL fetcher by another name")
                .isEmpty();
    }

    @Test
    @DisplayName("the fetcher sends no credential of any kind")
    void noCredentialLeavesWithTheRequest() throws IOException {
        String code = executable(MAIN.resolve("product/detail/image/DetailImageFetcher.java"));
        for (String forbidden : ImageFetchPolicy.forbiddenHeaderNames()) {
            assertThat(code.toLowerCase(java.util.Locale.ROOT))
                    .as("%s must not be set on an anonymous CDN fetch", forbidden)
                    .doesNotContain("\"" + forbidden + "\"");
        }
        assertThat(code).as("redirects are handled here, under the policy, not by the client")
                .contains("Redirect.NEVER");
    }

    @Test
    @DisplayName("Stage 0 contains no model call — absent, not disabled")
    void theCensusCannotReachAModel() throws IOException {
        String code = executable(MAIN.resolve("connector/naver/NaverDetailImageCensusRunner.java"));
        for (String vendor : List.of("AgentLlmTransport", "AgentDraftGenerator", "LlmHttpClient",
                "anthropic", "openai", "api-key", "x-api-key")) {
            assertThat(code).as("%s has no business in a census", vendor).doesNotContain(vendor);
        }
    }

    @Test
    @DisplayName("nothing in main writes anything from a fetched image")
    void theCensusStoresNothing() throws IOException {
        String code = executable(MAIN.resolve("connector/naver/NaverDetailImageCensusRunner.java"));
        assertThat(code).doesNotContain(".save(").doesNotContain("Repository.save")
                .as("a census measures; it does not persist the thing it measured");
    }

    @Test
    @DisplayName("the image authorship has exactly ONE producer, and it is the publication path")
    void theImageLaneHasOneProducer() throws IOException {
        // THIS TEST IS THE LANE'S SWITCH. Until 2026-08-27 it asserted zero producers, and flipping
        // it was the deliberate, reviewable act of declaring the lane open. It stays as a count of
        // one so the authorship cannot quietly acquire a second writer: a provenance that two paths
        // can stamp is a provenance that means two different things.
        List<String> producers = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(f -> f.toString().endsWith(".java")).toList()) {
                if (source.getFileName().toString().equals("KnowledgeAuthorship.java")) {
                    continue;
                }
                if (executable(source).contains("AI_EXTRACTED_FROM_SELLER_IMAGE")) {
                    producers.add(source.getFileName().toString());
                }
            }
        }
        assertThat(producers)
                .as("only the publication path may stamp a sentence as read off a picture")
                .containsExactly("ProductDetailImageKnowledge.java");
    }
}
