package com.sellerops.knowledge.semantic;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.knowledge.KnowledgeEligibility;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The evidence-eligibility payload floor and its refusal-only guarantee, asserted.</b>
 *
 * <p>This is the widest of the three retrieval payloads — the customer's sentence and the seller's
 * passages in one request — so the thing worth pinning is what is NOT there: the passages travel by
 * position, and no source id, chunk id, product or organisation goes with them.
 */
class KnowledgeEligibilityPayloadFloorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID ORG = UUID.randomUUID();

    private static KnowledgeEligibilityProperties properties() {
        return new KnowledgeEligibilityProperties(true, ORG.toString(), "test-model", "k", 600, "minimal");
    }

    private static KnowledgeEvidenceEligibility judgeReturning(String content) {
        String body = "{\"choices\":[{\"message\":{\"content\":" + MAPPER.valueToTree(content) + "}}]}";
        AgentLlmTransport transport = (uri, headers, request) -> new AgentLlmTransport.Response(200, body);
        return new KnowledgeEvidenceEligibility(properties(), null, transport);
    }

    @Test
    @DisplayName("the request carries the sentence and the passages by position — no identifier of any kind")
    void thePayloadCarriesNoIdentifier() throws Exception {
        String body = new KnowledgeEligibilityGenerator(
                (uri, headers, request) -> new AgentLlmTransport.Response(200, ""), properties())
                .requestBody("물에 닿아도 되나요?", List.of("부착 방법 안내\n표면의 유분을 제거하세요."));
        JsonNode root = MAPPER.readTree(body);
        assertThat(root.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "model", "messages", "max_completion_tokens", "response_format", "reasoning_effort");
        JsonNode user = MAPPER.readTree(root.path("messages").path(1).path("content").asText());
        assertThat(user.fieldNames()).toIterable().containsExactlyInAnyOrder("customer", "passages");
        assertThat(user.path("passages").path(0).fieldNames()).toIterable()
                .containsExactlyInAnyOrder("i", "text");
        assertThat(body).doesNotContain(ORG.toString())
                .doesNotContain("sourceId").doesNotContain("chunkId").doesNotContain("productId");
    }

    @Test
    @DisplayName("it can refuse a passage and can never add one")
    void itOnlyRefuses() {
        List<String> hits = List.of("A", "B");
        KnowledgeEvidenceEligibility judge = judgeReturning(
                "{\"verdicts\":[{\"i\":0,\"supports\":false},{\"i\":1,\"supports\":true}]}");
        assertThat(judge.filter(ORG, "질문", true, hits, s -> s)).containsExactly("B");
        // Nothing it says can produce a passage the scorer did not rank.
        assertThat(judge.filter(ORG, "질문", true, List.<String>of(), s -> s)).isEmpty();
    }

    @Test
    @DisplayName("no opinion leaves the search exactly as the scorer left it")
    void silenceChangesNothing() {
        List<String> hits = List.of("A", "B");
        assertThat(judgeReturning("").filter(ORG, "질문", true, hits, s -> s)).isEqualTo(hits);
        assertThat(judgeReturning("{\"verdicts\":[]}").filter(ORG, "질문", true, hits, s -> s)).isEqualTo(hits);
        assertThat(new KnowledgeEvidenceEligibility(properties(), null,
                (uri, headers, request) -> new AgentLlmTransport.Response(500, "no"))
                .filter(ORG, "질문", true, hits, s -> s)).isEqualTo(hits);
        // Off for this org, and off entirely.
        assertThat(judgeReturning("{\"verdicts\":[{\"i\":0,\"supports\":false}]}")
                .filter(UUID.randomUUID(), "질문", true, hits, s -> s)).isEqualTo(hits);
        assertThat(KnowledgeEvidenceEligibility.disabled().filter(ORG, "질문", true, hits, s -> s))
                .isEqualTo(hits);
        // A passage it was not asked about is kept, not dropped.
        KnowledgeEligibility partial = judgeReturning("{\"verdicts\":[{\"i\":0,\"supports\":true}]}")
                .forQuestion(ORG, "질문", hits);
        assertThat(partial.supports("B")).isTrue();
    }

    @Test
    @DisplayName("more passages than it was designed for means no judgement, not a worse one")
    void itIsBounded() {
        List<String> many = List.of("a", "b", "c", "d", "e", "f", "g");
        assertThat(many).hasSizeGreaterThan(KnowledgeEvidenceEligibility.MAX_JUDGED);
        assertThat(judgeReturning("{\"verdicts\":[{\"i\":0,\"supports\":false}]}")
                .filter(ORG, "질문", true, many, s -> s)).isEqualTo(many);
    }
}
