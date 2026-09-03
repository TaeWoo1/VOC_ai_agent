package com.sellerops.knowledge.semantic;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The retrieval-intent payload floor, asserted on the bytes.</b>
 *
 * <p>An intention is not a boundary. What this capability sends is one customer sentence and a fixed
 * instruction — and the way to know that is to serialize a request whose inputs contain identifiers
 * and check that none of them are in it.
 */
class KnowledgeQuestionIntentPayloadFloorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static KnowledgeQuestionIntentGenerator generator() {
        return new KnowledgeQuestionIntentGenerator(
                (uri, headers, body) -> new com.sellerops.agent.llm.AgentLlmTransport.Response(200, ""),
                new KnowledgeQuestionIntentProperties(true, "", "test-model", "k", 400, "minimal"));
    }

    @Test
    @DisplayName("the request carries the model, the instruction and the customer's sentence — nothing else")
    void thePayloadIsTheQuestion() throws Exception {
        String body = generator().requestBody("자꾸 붕 뜨는데요");
        JsonNode root = MAPPER.readTree(body);
        assertThat(root.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "model", "messages", "max_completion_tokens", "response_format", "reasoning_effort");
        assertThat(root.path("model").asText()).isEqualTo("test-model");
        assertThat(root.path("messages")).hasSize(2);
        assertThat(root.path("messages").path(0).path("role").asText()).isEqualTo("system");
        assertThat(root.path("messages").path(1).path("content").asText()).isEqualTo("자꾸 붕 뜨는데요");
        // The seller's own material is not in this request at all — that is the sixth capability's
        // payload, and the two are separate exposures precisely so neither has to carry the other.
        assertThat(body).doesNotContain("orgId").doesNotContain("productId").doesNotContain("sourceId");
    }

    @Test
    @DisplayName("the instruction names no product, no seller and no synonym")
    void thePromptIsDomainFree() {
        String system = KnowledgeQuestionIntentPrompt.system();
        for (String word : List.of("몰딩", "실리콘", "선바로", "매트", "선풍기", "원두", "가죽")) {
            assertThat(system).as("a dictionary here is what stops working for the next seller")
                    .doesNotContain(word);
        }
        assertThat(system).contains("한 문장으로");
    }

    @Test
    @DisplayName("a restatement is never returned to a seller and never stored")
    void theRestatementIsNotEvidence() throws IOException {
        // It is a derived copy of a customer's wording, and this repository keeps exactly one copy of
        // that. Two source facts hold the line: nothing in main persists it, and the only class that
        // holds it hands it to the embedder and drops it.
        List<String> offenders = new ArrayList<>();
        Path main = Path.of("src", "main", "java", "com", "sellerops");
        try (Stream<Path> walk = Files.walk(main)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                String code = Files.readString(source);
                if (name.startsWith("KnowledgeQuestionIntent")
                        || name.equals("KnowledgeSemanticSearch.java")) {
                    continue;
                }
                if (code.contains("KnowledgeQuestionIntent")) {
                    offenders.add(name);
                }
            }
        }
        assertThat(offenders).as("only the door, its generator and the one search seam know about it")
                .isEmpty();
        String service = Files.readString(
                main.resolve("knowledge/semantic/KnowledgeQuestionIntent.java"));
        assertThat(service).doesNotContain("Repository").doesNotContain("@Entity")
                .doesNotContain("save(");
    }
}
