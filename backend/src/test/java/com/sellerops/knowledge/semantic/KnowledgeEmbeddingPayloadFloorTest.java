package com.sellerops.knowledge.semantic;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What leaves this deployment for the semantic-retrieval capability, asserted on the bytes.
 *
 * <p>The narrowest floor of the seven capabilities: a model name, a dimension count, and texts. An
 * embeddings request has nowhere to put an organisation, a product, a customer or an order, and this
 * test is here so nobody invents a place.
 */
class KnowledgeEmbeddingPayloadFloorTest {

    /** Any organisation: the id is a LOG field, and the payload floor test's job is that it is not
     *  a REQUEST field. Every assertion below still checks the serialized bytes for it. */
    private static final java.util.UUID SOME_ORG = java.util.UUID.randomUUID();

    private static KnowledgeEmbeddingGenerator generator() {
        return new KnowledgeEmbeddingGenerator((uri, headers, body) -> new AgentLlmTransport.Response(200, "{}"),
                new KnowledgeEmbeddingProperties(true, "*", "text-embedding-3-large", "k", 1024));
    }

    @Test
    @DisplayName("three fields leave, and nothing else")
    void theRequestCarriesOnlyTheTexts() throws Exception {
        String body = generator().requestBody(List.of("부착 방법 안내\n표면을 닦아 주세요."));
        var json = new ObjectMapper().readTree(body);
        assertThat(json.fieldNames()).toIterable().containsExactlyInAnyOrder("model", "dimensions", "input");
        assertThat(json.get("input")).hasSize(1);
        assertThat(json.get("model").asText()).isEqualTo("text-embedding-3-large");
        assertThat(json.get("dimensions").asInt()).isEqualTo(1024);
    }

    @Test
    @DisplayName("the key is never in the body")
    void theKeyTravelsInTheHeader() {
        assertThat(generator().requestBody(List.of("a"))).doesNotContain("k\"").doesNotContain("Bearer");
    }

    @Test
    @DisplayName("a vendor that refuses returns nothing rather than a guess")
    void aRefusalIsEmpty() {
        KnowledgeEmbeddingGenerator refused = new KnowledgeEmbeddingGenerator(
                (uri, headers, body) -> new AgentLlmTransport.Response(429, "slow down"),
                new KnowledgeEmbeddingProperties(true, "*", "m", "k", 1024));
        assertThat(refused
                .embed(SOME_ORG, KnowledgeEmbeddingGenerator.Kind.PASSAGE, List.of("a"))).isEmpty();
    }

    @Test
    @DisplayName("one endpoint, and it is the embeddings one")
    void oneEndpoint() {
        List<URI> called = new ArrayList<>();
        new KnowledgeEmbeddingGenerator((uri, headers, body) -> {
            called.add(uri);
            return new AgentLlmTransport.Response(500, "");
        }, new KnowledgeEmbeddingProperties(true, "*", "m", "k", 1024))
                .embed(SOME_ORG, KnowledgeEmbeddingGenerator.Kind.PASSAGE, List.of("a"));
        assertThat(called).containsExactly(URI.create("https://api.openai.com/v1/embeddings"));
    }

    /**
     * <b>The semantic lane reads the lane's candidate list and never the database.</b>
     *
     * <p>This is the whole reason product scope, organisation scope, variant applicability and
     * retired documents keep working unchanged: they are decided before this class is called, on the
     * list it is handed. A repository here would be a second place that decides what a seller may be
     * shown, and the first thing it would get wrong is a retired manual.
     */
    @Test
    @DisplayName("the search that ranks by meaning cannot widen what it may see")
    void theSemanticLaneOwnsNoQuery() throws Exception {
        String code = Files.readString(Path.of("src/main/java/com/sellerops/knowledge/semantic",
                        "KnowledgeSemanticSearch.java"))
                .replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
        assertThat(code)
                .doesNotContain("Repository")
                .doesNotContain("findAll")
                .doesNotContain("isActive")
                .doesNotContain("Product")
                .doesNotContain("Source");
        // The organisation is passed in and used for one thing only: which cache the vectors come
        // from. It never selects passages — those arrive as the argument below.
        assertThat(code).contains("List<KnowledgeRetriever.Candidate<T>> candidates");
    }

    /**
     * A question is embedded and dropped; a passage is embedded and kept. Nothing writes a customer's
     * words to this table, and the entity has no column that could hold them.
     */
    @Test
    @DisplayName("the vector cache stores no text")
    void theCacheHoldsHashesNotSentences() throws Exception {
        String entity = Files.readString(
                Path.of("src/main/java/com/sellerops/knowledge/semantic/KnowledgeEmbedding.java"));
        for (String forbidden : List.of("content;", "String text", "question", "body")) {
            assertThat(entity).doesNotContain(forbidden);
        }
        try (Stream<Path> walk = Files.walk(Path.of("src/main/java/com/sellerops"))) {
            List<String> writers = walk.filter(p -> p.toString().endsWith(".java"))
                    .filter(p -> {
                        try {
                            return Files.readString(p).contains("KnowledgeEmbeddingRepository");
                        } catch (Exception e) {
                            return false;
                        }
                    })
                    .map(p -> p.getFileName().toString()).sorted().toList();
            assertThat(writers).containsExactly("KnowledgeEmbeddingRepository.java",
                    "KnowledgeEmbeddingService.java");
        }
    }

    @Test
    @DisplayName("off is off: no organisation, no key, no call")
    void theCapabilityIsSeparable() {
        KnowledgeEmbeddingProperties off =
                new KnowledgeEmbeddingProperties(false, "*", "m", "k", 1024);
        assertThat(off.isDeployed()).isFalse();
        KnowledgeEmbeddingProperties keyless =
                new KnowledgeEmbeddingProperties(true, "*", "m", "", 1024);
        assertThat(keyless.isDeployed()).isFalse();
        assertThat(new KnowledgeEmbeddingProperties(true, "", "m", "k", 1024).namesAnyOrg()).isFalse();
        assertThat(off.capabilityName()).isEqualTo("SELLEROPS_KNOWLEDGE_EMBEDDING");
    }

    @Test
    @DisplayName("a disabled search asks for nothing")
    void aDisabledSearchIsNull() {
        assertThat(KnowledgeSemanticSearch.disabled().enabledFor(java.util.UUID.randomUUID())).isFalse();
        assertThat(KnowledgeSemanticSearch.disabled().forQuestion(java.util.UUID.randomUUID(), "두께",
                List.of(new com.sellerops.knowledge.KnowledgeRetriever.Candidate<>("x", "x", "x"))))
                .isNull();
    }

    @Test
    @DisplayName("headers carry the key and the body does not")
    void theTransportSeesTheKeyOnce() {
        List<Map<String, String>> headers = new ArrayList<>();
        new KnowledgeEmbeddingGenerator((uri, h, body) -> {
            headers.add(h);
            return new AgentLlmTransport.Response(500, "");
        }, new KnowledgeEmbeddingProperties(true, "*", "m", "secret-value", 1024))
                .embed(SOME_ORG, KnowledgeEmbeddingGenerator.Kind.PASSAGE, List.of("a"));
        assertThat(headers).singleElement().satisfies(h ->
                assertThat(h).containsOnlyKeys("Authorization"));
    }
}
