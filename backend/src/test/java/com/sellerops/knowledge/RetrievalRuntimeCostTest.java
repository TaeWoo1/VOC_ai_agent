package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.knowledge.semantic.KnowledgeEligibilityProperties;
import com.sellerops.knowledge.semantic.KnowledgeEmbeddingProperties;
import com.sellerops.knowledge.semantic.KnowledgeEmbeddingRepository;
import com.sellerops.knowledge.semantic.KnowledgeEmbeddingService;
import com.sellerops.knowledge.semantic.KnowledgeEvidenceEligibility;
import com.sellerops.knowledge.semantic.KnowledgeQuestionIntent;
import com.sellerops.knowledge.semantic.KnowledgeQuestionIntentProperties;
import com.sellerops.knowledge.semantic.KnowledgeSemanticSearch;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.product.library.KnowledgeVariantScope;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>What one grounded draft costs a vendor, counted.</b> Retrieval Runtime Closure v1 §6.
 *
 * <p>Latency is a property of a machine and a network; the NUMBER of round trips is a property of
 * this code, so it is measured here rather than in a live sitting, where it would be a number nobody
 * could reproduce. Three real lanes over a real database, sharing the three doors exactly as Spring
 * wires them, with the vendor replaced by a counter.
 *
 * <p>The v2 shape this closes: the same customer sentence was leaving as up to SIX identical
 * embedding requests for one draft — three lanes, each embedding the sentence and its restatement —
 * and the judge was asked separately per lane with no memory of an identical question. None of it
 * was wrong; all of it was paid for more than once.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class RetrievalRuntimeCostTest {

    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired KnowledgeEmbeddingRepository embeddingRows;
    @Autowired OrganizationRepository organizations;

    /** The question, as a customer wrote it — one sentence, asked of all three lanes. */
    private static final String ASKED = "설치는 했는데 자꾸 흔들리는 느낌이에요 배송도 오래 걸렸어요";

    private static final String PRODUCT_TITLE = "장착 방법과 각도 조절";
    private static final String PRODUCT_BODY =
            "카시트는 차량 시트에 밀착시킨 뒤 벨트를 끝까지 당겨 고정합니다. 고정 후 좌우로 2cm 이상 흔들리면 "
                    + "벨트가 덜 조여진 상태이므로 다시 조여 주세요.";
    private static final String PRODUCT_BODY_EDITED = PRODUCT_BODY + " 신생아는 1단계만 사용해 주세요.";

    private final AtomicInteger embeddings = new AtomicInteger();
    private final AtomicInteger intents = new AtomicInteger();
    private final AtomicInteger judgements = new AtomicInteger();
    /** Monotonic, and deliberately NOT reset between phases: it makes each restatement a distinct
     *  string, so a fixture that reused one could not be mistaken for the memo doing its job. */
    private final AtomicInteger restatements = new AtomicInteger();

    private ProductKnowledgeLibraryService productLane;
    private SellerOperationsKnowledgeService orgLane;
    private AnswerMemoryService memoryLane;
    private UUID org;
    private UUID productId;
    private UUID productSourceId;

    /**
     * One transport for all three capabilities, counting by endpoint.
     *
     * <p>The embedding answer is a fixed one-dimensional vector per text, which makes every passage
     * equally close to every question. That is deliberate: this measures HOW MANY TIMES the vendor is
     * asked, and a fixture that also decided WHICH passage wins would be re-testing the retrieval
     * quality this package does not touch.
     */
    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    private AgentLlmTransport transport() {
        return (uri, headers, request) -> {
            String path = uri.getPath();
            if (path.contains("embeddings")) {
                embeddings.incrementAndGet();
                StringBuilder data = new StringBuilder("{\"data\":[");
                try {
                    com.fasterxml.jackson.databind.JsonNode input =
                            MAPPER.readTree(request).path("input");
                    for (int i = 0; i < input.size(); i++) {
                        // Two dimensions, and which one is set is decided by a WORD both the
                        // question and one passage sentence use. The fixture has to make ONE passage
                        // win, or the absence gate refuses the lane and no judgement is ever bought —
                        // and then this would be measuring an empty search.
                        boolean onTopic = input.get(i).asText("").contains("흔들리");
                        data.append(i > 0 ? "," : "").append("{\"index\":").append(i)
                                .append(",\"embedding\":[")
                                .append(onTopic ? "1.0,0.0" : "0.0,1.0").append("]}");
                    }
                } catch (Exception e) {
                    return new AgentLlmTransport.Response(500, "unparseable");
                }
                return new AgentLlmTransport.Response(200, data.append("]}").toString());
            }
            if (request.contains("passages")) {
                judgements.incrementAndGet();
                return new AgentLlmTransport.Response(200,
                        "{\"choices\":[{\"message\":{\"content\":\"{\\\"verdicts\\\":["
                                + "{\\\"i\\\":0,\\\"supports\\\":true},"
                                + "{\\\"i\\\":1,\\\"supports\\\":true},"
                                + "{\\\"i\\\":2,\\\"supports\\\":true},"
                                + "{\\\"i\\\":3,\\\"supports\\\":true}"
                                + "]}\"}}]}");
            }
            // A DISTINCT restatement per call, so a second question cannot be mistaken for a memo
            // hit on the first one's restatement.
            intents.incrementAndGet();
            int nth = restatements.incrementAndGet();
            return new AgentLlmTransport.Response(200,
                    "{\"choices\":[{\"message\":{\"content\":\"{\\\"intent\\\":"
                            + "\\\"restated-" + nth + "\\\"}\"}}]}");
        };
    }

    @BeforeEach
    void setUp() {
        AgentLlmTransport transport = transport();
        KnowledgeEmbeddingService embedder = new KnowledgeEmbeddingService(
                new KnowledgeEmbeddingProperties(true, "*", "test-embed", "k", 1), embeddingRows,
                null, transport);
        KnowledgeQuestionIntent intent = new KnowledgeQuestionIntent(
                new KnowledgeQuestionIntentProperties(true, "*", "test-intent", "k", 400, "minimal"),
                null, transport);
        KnowledgeEvidenceEligibility judge = new KnowledgeEvidenceEligibility(
                new KnowledgeEligibilityProperties(true, "*", "test-judge", "k", 600, "minimal"),
                null, transport);
        KnowledgeSemanticSearch semantic = new KnowledgeSemanticSearch(embedder, intent);

        productLane = new ProductKnowledgeLibraryService(products, productSources, productChunks,
                variants, semantic, judge);
        orgLane = new SellerOperationsKnowledgeService(orgSources, orgChunks, semantic, judge);
        memoryLane = new AnswerMemoryService(memories, orgChunks, productChunks, semantic, judge);

        Organization o = new Organization();
        o.setName("측정용 상점");
        org = organizations.save(o).getId();
        Product p = new Product();
        p.setOrgId(org);
        p.setName("QA 카시트");
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        productId = products.save(p).getId();

        productSourceId = productLane.create(org, productId,
                new KnowledgeSourceRequest(KnowledgeSourceType.USAGE, PRODUCT_TITLE, PRODUCT_BODY,
                        null),
                UUID.randomUUID(), "판매자").id();
        orgLane.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.SHIPPING_POLICY, "배송 안내",
                        "주문은 영업일 기준 1~2일 안에 출고되며 도착까지 2~3일 걸립니다.", null),
                UUID.randomUUID(), "판매자");
    }

    /** The three lanes of ONE draft, in the order {@code InquiryEvidenceRetriever} runs them. */
    private void oneDraftsWorthOfRetrieval() {
        RetrievalQuery question = RetrievalQuery.ofCustomer(null, ASKED);
        productLane.search(org, productId, question, 4, KnowledgeVariantScope.unresolved());
        orgLane.search(org, question, 4);
        memoryLane.search(org, question, productId, null, 4);
    }

    private List<Integer> counts() {
        return List.of(embeddings.get(), intents.get(), judgements.get());
    }

    private void resetCounts() {
        embeddings.set(0);
        intents.set(0);
        judgements.set(0);
    }

    @Test
    @DisplayName("cold, repeat and after-an-edit — the measured cost of each")
    void theMeasuredCostOfTheFourPaths() {
        // ── cold generation ──────────────────────────────────────────────────────────────────────
        // Every passage of both libraries is embedded once (and cached in the database forever), the
        // question is embedded once, the restatement is bought once and embedded once, and each lane
        // that found passages is judged once.
        resetCounts();
        oneDraftsWorthOfRetrieval();
        List<Integer> cold = counts();
        assertThat(cold.get(1)).as("one sentence, one restatement, however many lanes").isEqualTo(1);
        assertThat(cold.get(0)).as("passage batches + the two phrasings, each bought once")
                .isLessThanOrEqualTo(4);
        int coldJudgements = cold.get(2);
        assertThat(coldJudgements).as("one judgement per lane that ranked something")
                .isBetween(1, 3);

        // ── same draft reopened ──────────────────────────────────────────────────────────────────
        // Not measured here because it cannot be: a read path holds no retriever at all
        // (RetrievalRuntimeClosureTest). Its cost is zero by construction, not by caching.

        // ── regenerate over an unchanged library ─────────────────────────────────────────────────
        // The passages are cached in the database, the question and the restatement in the memo, and
        // the judgement is keyed by the question AND the passages — so nothing has changed and
        // nothing is bought. This is also the property the holdout measurement found missing: the
        // same draft, regenerated, now sees the same evidence.
        resetCounts();
        oneDraftsWorthOfRetrieval();
        assertThat(counts()).as("a regenerate over an unchanged library reaches no vendor")
                .containsExactly(0, 0, 0);

        // ── regenerate after the seller edits the knowledge ──────────────────────────────────────
        // The edited document is a different passage, so its sentences are embedded and the lane
        // whose passages changed is judged again. The question did not change, so the restatement is
        // not bought again, and the OTHER lane's judgement still stands.
        productLane.update(org, productSourceId, new KnowledgeSourceRequest(
                KnowledgeSourceType.USAGE, PRODUCT_TITLE, PRODUCT_BODY_EDITED, null));
        resetCounts();
        oneDraftsWorthOfRetrieval();
        List<Integer> afterEdit = counts();
        assertThat(afterEdit.get(1)).as("the question did not change").isZero();
        assertThat(afterEdit.get(0)).as("the changed passage's sentences").isEqualTo(1);
        assertThat(afterEdit.get(2)).as("only the lane whose passages changed").isEqualTo(1);

        // Printed so the package's §6 table is read off a run rather than reasoned about.
        System.out.println("RRC_COST cold=" + cold + " regenerate=[0, 0, 0] afterEdit=" + afterEdit
                + " (embeddings, intents, judgements)");
    }

    /**
     * The vector cache is content-addressed, so the corpus is embedded once per organisation and
     * never again — including across processes, which the memo cannot do and the table can.
     */
    @Test
    @DisplayName("a second question over the same library buys only its own two phrasings")
    void theCorpusIsEmbeddedOncePerOrganisation() {
        resetCounts();
        oneDraftsWorthOfRetrieval();
        assertThat(embeddings.get()).isPositive();

        resetCounts();
        RetrievalQuery other = RetrievalQuery.ofCustomer(null, "각도 조절은 몇 단계까지 되나요?");
        productLane.search(org, productId, other, 4, KnowledgeVariantScope.unresolved());
        orgLane.search(org, other, 4);
        memoryLane.search(org, other, productId, null, 4);
        assertThat(intents.get()).as("a new question, one restatement").isEqualTo(1);
        assertThat(embeddings.get()).as("the two phrasings of the new question, and no passage")
                .isEqualTo(2);
    }
}
