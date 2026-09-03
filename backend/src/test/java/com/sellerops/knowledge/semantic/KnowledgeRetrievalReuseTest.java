package com.sellerops.knowledge.semantic;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>One unit of work pays a vendor once for one sentence.</b> Retrieval Runtime Closure v1 §3.
 *
 * <p>The defect these pin: one grounded draft searches THREE lanes (product knowledge, operating
 * policy, past answers) with one question, and since v2 with TWO phrasings of it — so the same
 * customer sentence was leaving as up to six identical embedding requests, and the judge was asked
 * separately per lane with no memory of an identical question. None of it was wrong; all of it was
 * paid for more than once.
 *
 * <p>Each assertion counts VENDOR CALLS through the transport, not elapsed time: latency is a
 * property of a machine and a network, and «how many times did this leave» is a property of this
 * code.
 */
class KnowledgeRetrievalReuseTest {

    private static final UUID ORG = UUID.randomUUID();

    /** A transport that answers everything and counts. */
    private static AgentLlmTransport counting(AtomicInteger calls, String body) {
        return (uri, headers, request) -> {
            calls.incrementAndGet();
            return new AgentLlmTransport.Response(200, body);
        };
    }

    @Test
    @DisplayName("three lanes, one question: the restatement is bought once")
    void theRestatementIsBoughtOnce() {
        AtomicInteger calls = new AtomicInteger();
        KnowledgeQuestionIntent intent = new KnowledgeQuestionIntent(
                new KnowledgeQuestionIntentProperties(true, ORG.toString(), "m", "k", 400, "minimal"),
                null,
                counting(calls, "{\"choices\":[{\"message\":{\"content\":"
                        + "\"{\\\"intent\\\":\\\"제품이 사용 중 들뜨는 문제\\\"}\"}}]}"));

        String asked = "자꾸 붕 뜨는데요";
        assertThat(intent.intentOf(ORG, asked)).isEqualTo("제품이 사용 중 들뜨는 문제");
        assertThat(intent.remembers(asked)).isTrue();
        assertThat(intent.intentOf(ORG, asked)).isEqualTo("제품이 사용 중 들뜨는 문제");
        assertThat(intent.intentOf(ORG, asked)).isEqualTo("제품이 사용 중 들뜨는 문제");
        assertThat(calls).as("one sentence, one call").hasValue(1);

        // A different sentence is a different question, and pays.
        intent.intentOf(ORG, "며칠이면 도착해요?");
        assertThat(calls).hasValue(2);
    }

    @Test
    @DisplayName("the question vector is embedded once, however many lanes ask for it")
    void theQuestionVectorIsEmbeddedOnce() {
        AtomicInteger calls = new AtomicInteger();
        String body = "{\"data\":[{\"index\":0,\"embedding\":[0.1,0.2]}]}";
        KnowledgeEmbeddingService embeddings = new KnowledgeEmbeddingService(
                new KnowledgeEmbeddingProperties(true, ORG.toString(), "m", "k", 2),
                null, null, counting(calls, body));

        String asked = "두께가 어떻게 되나요";
        assertThat(embeddings.questionVector(ORG, asked)).hasSize(2);
        assertThat(embeddings.questionVector(ORG, asked)).hasSize(2);
        assertThat(embeddings.questionVector(ORG, asked)).hasSize(2);
        assertThat(calls).hasValue(1);
        // The restatement is a different string, so it is a different vector, and it pays once too.
        embeddings.questionVector(ORG, "제품의 두께 규격에 대한 문의");
        assertThat(calls).hasValue(2);
    }

    /**
     * The judge's key is the question AND the passages, which is the condition under which its
     * verdict cannot have changed.
     */
    @Test
    @DisplayName("the same question over the same passages is judged once; an edited passage is not")
    void theJudgementIsBoughtOncePerSnapshot() {
        AtomicInteger calls = new AtomicInteger();
        KnowledgeEvidenceEligibility judge = new KnowledgeEvidenceEligibility(
                new KnowledgeEligibilityProperties(true, ORG.toString(), "m", "k", 600, "minimal"),
                null,
                counting(calls, "{\"choices\":[{\"message\":{\"content\":"
                        + "\"{\\\"verdicts\\\":[{\\\"i\\\":0,\\\"supports\\\":true}]}\"}}]}"));

        List<String> passages = List.of("부착 방법 안내\n표면의 유분을 제거하세요.");
        assertThat(judge.filter(ORG, "질문", true, passages, s -> s)).isEqualTo(passages);
        assertThat(judge.remembers("질문", passages)).isTrue();
        assertThat(judge.filter(ORG, "질문", true, passages, s -> s)).isEqualTo(passages);
        assertThat(calls).as("a regenerate over an unchanged library re-asks nothing").hasValue(1);

        // An edited document is a different passage, so the verdict is bought again.
        List<String> edited = List.of("부착 방법 안내\n표면의 유분과 먼지를 제거하세요.");
        judge.filter(ORG, "질문", true, edited, s -> s);
        assertThat(calls).hasValue(2);
        // A different question over the same passages, likewise.
        judge.filter(ORG, "다른 질문", true, passages, s -> s);
        assertThat(calls).hasValue(3);
    }

    /**
     * A seller searching their own library is not judged at all.
     *
     * <p>§4. The passages are the seller's own documents and they asked to see them; a refusal-only
     * model in that position hides what they wrote from the person who wrote it.
     */
    @Test
    @DisplayName("a question the seller wrote costs no judgement and loses no passage")
    void aSellersOwnSearchIsNotJudged() {
        AtomicInteger calls = new AtomicInteger();
        KnowledgeEvidenceEligibility judge = new KnowledgeEvidenceEligibility(
                new KnowledgeEligibilityProperties(true, ORG.toString(), "m", "k", 600, "minimal"),
                null,
                counting(calls, "{\"choices\":[{\"message\":{\"content\":"
                        + "\"{\\\"verdicts\\\":[{\\\"i\\\":0,\\\"supports\\\":false}]}\"}}]}"));

        List<String> passages = List.of("반품 안내\n왕복 배송비 6,000원이 발생합니다.");
        assertThat(judge.filter(ORG, "반품 조건", false, passages, s -> s)).isEqualTo(passages);
        assertThat(calls).hasValue(0);
        // The same passages, asked by a customer, are judged — and this one is refused.
        assertThat(judge.filter(ORG, "반품 조건", true, passages, s -> s)).isEmpty();
        assertThat(calls).hasValue(1);
    }
}
