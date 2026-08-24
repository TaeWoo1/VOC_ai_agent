package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftResponseParser;
import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import com.sellerops.inquiry.proposal.RuleBasedInquiryProposalProvider;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.dto.KnowledgePassage;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Inquiry Draft v1: what the draft is grounded in, and — more importantly — what it does NOT claim
 * to be grounded in.
 *
 * <p>The four {@link DraftKnowledgeState} values are four different sentences a seller reads above a
 * reply they are about to send under their own name, so each gets its own test. The two that matter
 * most are the negatives: a draft written by the deterministic fallback must never be labelled
 * GROUNDED even when the retrieval succeeded (nothing that wrote it saw those passages), and a
 * product with no library must stay distinguishable from a library that does not cover the question.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryDraftComposerTest {

    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryReplyDraftRepository draftRows;
    @Autowired InquiryDraftEvidenceRepository evidence;
    @Autowired ProductRepository products;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired ChannelOrderRepository channelOrders;

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private InquiryReplyDraftService draftService;

    @BeforeEach
    void setUp() {
        draftService = new InquiryReplyDraftService(workItems, draftRows);
    }

    @Test
    @DisplayName("GROUNDED: the retrieved passages reach the model AND become citations")
    void grounded() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);
        StubLibrary library = StubLibrary.returning(passage("사용법", "테이프를 벗기고 벽면에 붙입니다."));
        StubModel model = StubModel.writing("[답변] 사용 방법", "테이프를 벗기고 벽면에 붙이시면 됩니다.");

        GeneratedDraftView view = composer(library, model).generate(org, wi.getId(), user);

        assertThat(view.knowledgeState()).isEqualTo(DraftKnowledgeState.GROUNDED.name());
        assertThat(view.authorKind()).isEqualTo(DraftAuthorKind.MODEL.name());
        assertThat(model.sawKnowledge).as("evidence retrieved but not shown is not grounding")
                .extracting(AgentDraftGenerator.Passage::text)
                .containsExactly("테이프를 벗기고 벽면에 붙입니다.");
        assertThat(view.evidence()).singleElement()
                .satisfies(e -> {
                    assertThat(e.title()).isEqualTo("사용법");
                    assertThat(e.locator()).isEqualTo("product-knowledge/USAGE:데모 운영자");
                });
        assertThat(evidence.findAllByWorkItemIdAndDraftVersionOrderByOrdinalAsc(
                wi.getId(), view.draft().version())).hasSize(1);
    }

    @Test
    @DisplayName("ingest's shared (미지정 상품) bucket is NOT a product — it is NO_PRODUCT, not NO_LIBRARY")
    void unspecifiedBucketIsNotAProduct() {
        // Most of the live Cafe24 backlog carries a non-null productId pointing at this one shared
        // row. Reporting NO_LIBRARY about it would say "이 상품에 등록된 상품 지식이 없다" about a
        // product that does not exist, and invite the seller to write knowledge into a bucket.
        Product bucket = new Product();
        bucket.setOrgId(org);
        bucket.setName("(미지정 상품)");
        bucket.setSku("SKU-" + UUID.randomUUID());
        bucket.setStatus("ACTIVE");
        UUID bucketId = products.save(bucket).getId();
        InquiryWorkItem wi = seedProposed(bucketId);
        StubLibrary library = StubLibrary.empty(0);

        GeneratedDraftView view = composer(library, StubModel.writing("제목", "본문"))
                .generate(org, wi.getId(), user);

        assertThat(view.knowledgeState()).isEqualTo(DraftKnowledgeState.NO_PRODUCT.name());
        assertThat(library.searched).isFalse();
        assertThat(view.productId()).isNull();
    }

    @Test
    @DisplayName("NO_PRODUCT: an inquiry with no canonical product retrieves nothing and says so")
    void noProduct() {
        InquiryWorkItem wi = seedProposed(null);
        StubLibrary library = StubLibrary.returning(passage("사용법", "쓰이지 않아야 합니다."));

        GeneratedDraftView view = composer(library, StubModel.writing("제목", "본문"))
                .generate(org, wi.getId(), user);

        assertThat(view.knowledgeState()).isEqualTo(DraftKnowledgeState.NO_PRODUCT.name());
        assertThat(library.searched).as("no product means there is nothing to search").isFalse();
        assertThat(view.evidence()).isEmpty();
        assertThat(view.knowledgeNote()).contains("상품과 연결되지 않았고");
    }

    @Test
    @DisplayName("NO_LIBRARY and NO_MATCH are different sentences, because they are different problems")
    void twoKindsOfAbsence() {
        UUID productId = seedProduct();

        InquiryWorkItem empty = seedProposed(productId);
        GeneratedDraftView emptyView = composer(StubLibrary.empty(0), StubModel.writing("제목", "본문"))
                .generate(org, empty.getId(), user);
        assertThat(emptyView.knowledgeState()).isEqualTo(DraftKnowledgeState.NO_LIBRARY.name());

        InquiryWorkItem unmatched = seedProposed(productId);
        GeneratedDraftView unmatchedView = composer(StubLibrary.empty(3), StubModel.writing("제목", "본문"))
                .generate(org, unmatched.getId(), user);
        assertThat(unmatchedView.knowledgeState()).isEqualTo(DraftKnowledgeState.NO_MATCH.name());

        assertThat(emptyView.knowledgeNote()).isNotEqualTo(unmatchedView.knowledgeNote());
    }

    @Test
    @DisplayName("no model ran — the draft is RULE, is never called GROUNDED, and cites nothing")
    void ruleFallbackClaimsNoGrounding() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);
        StubLibrary library = StubLibrary.returning(passage("사용법", "테이프를 벗기고 붙입니다."));

        GeneratedDraftView view = composer(library, StubModel.disabled()).generate(org, wi.getId(), user);

        assertThat(view.authorKind()).isEqualTo(DraftAuthorKind.RULE.name());
        assertThat(view.knowledgeState())
                .as("passages existed, but nothing that wrote this draft ever saw them")
                .isEqualTo(DraftKnowledgeState.NO_MATCH.name());
        assertThat(view.evidence()).isEmpty();
        assertThat(view.draft().comments()).isNotBlank();
    }

    @Test
    @DisplayName("the day's AI budget is spent — a draft is still written, and the reason is said")
    void quotaExhaustedStillProducesADraft() {
        InquiryWorkItem wi = seedProposed(null);

        GeneratedDraftView view = composer(StubLibrary.empty(0), StubModel.writing("제목", "본문"),
                exhaustedQuota()).generate(org, wi.getId(), user);

        assertThat(view.authorKind()).isEqualTo(DraftAuthorKind.RULE.name());
        assertThat(view.quotaMessage()).contains("오늘");
        assertThat(view.draft().comments()).isNotBlank();
    }

    @Test
    @DisplayName("a regenerate appends a version, so an approval bound to the previous one is stale")
    void regenerateAppendsAndInvalidates() {
        InquiryWorkItem wi = seedProposed(null);

        GeneratedDraftView first = composer(StubLibrary.empty(0), StubModel.writing("첫 제목", "첫 본문"))
                .generate(org, wi.getId(), user);
        GeneratedDraftView next = composer(StubLibrary.empty(0), StubModel.writing("둘째 제목", "둘째 본문"))
                .generate(org, wi.getId(), user);

        assertThat(next.draft().version()).isEqualTo(first.draft().version() + 1);
        assertThat(next.draft().contentFingerprint()).isNotEqualTo(first.draft().contentFingerprint());
    }

    @Test
    @DisplayName("the question reaches the model as text — the stored body may be a mail thread in markup")
    void markupNeverReachesTheDrafter() {
        InquiryWorkItem wi = seedProposed(null);
        StubModel model = StubModel.writing("제목", "본문");

        composer(StubLibrary.empty(0), model).generate(org, wi.getId(), user);

        assertThat(model.sawTitle).isEqualTo("사용 방법이 궁금합니다");
        assertThat(model.sawDetails).doesNotContain("<p>").doesNotContain("&nbsp;");
    }

    @Test
    @DisplayName("the retrieval query is bounded — a forwarded mail thread is not the question")
    void queryIsBounded() {
        String thread = "재고 있나요? " + "인용된 지난 대화 ".repeat(200);
        assertThat(InquiryEvidenceRetriever.query("제목", thread))
                .hasSize(InquiryEvidenceRetriever.QUERY_CHARS)
                .startsWith("제목 재고 있나요?");
    }

    // ---- helpers ----

    private InquiryDraftComposer composer(StubLibrary library, StubModel model) {
        return composer(library, model, allowingQuota());
    }

    private InquiryDraftComposer composer(StubLibrary library, StubModel model, AgentQuotaService quota) {
        // The real retriever over a stubbed product lane: the org-policy and past-answer lanes run
        // against genuinely empty stores, which is the state these cases are about.
        InquiryEvidenceRetriever retriever = new InquiryEvidenceRetriever(products, library,
                new SellerOperationsKnowledgeService(orgSources, orgChunks),
                new AnswerMemoryService(memories, orgChunks, productChunks),
                new InquiryOrderContextReader(channelOrders));
        return new InquiryDraftComposer(workItems, inquiries, draftService, evidence, retriever, model,
                quota, new RuleBasedInquiryProposalProvider());
    }

    private static KnowledgePassage passage(String title, String content) {
        return new KnowledgePassage(UUID.randomUUID(), UUID.randomUUID(), KnowledgeSourceType.USAGE,
                title, content, 0, 0.82, "데모 운영자", null, Instant.parse("2026-08-24T00:00:00Z"));
    }

    private UUID seedProduct() {
        Product p = new Product();
        p.setOrgId(org);
        p.setName("선바로 일체형 전선몰딩");
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }

    private InquiryWorkItem seedProposed(UUID productId) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setTitle("<p>사용 방법이 궁금합니다</p>");
        q.setBody("<p>처음 써봅니다.</p>&nbsp;");
        q.setStatus("UNANSWERED");
        q.setProductId(productId);
        q.setReceivedAt(Instant.parse("2026-08-22T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(q.getChannelId());
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        return workItems.save(wi);
    }

    /** Always allows. The quota's own arithmetic is {@code AgentQuotaServiceTest}'s subject. */
    private static AgentQuotaService allowingQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String runId) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
    }

    private static AgentQuotaService exhaustedQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String runId) {
                return new QuotaDecision(false, QuotaDecision.Reason.DAILY_LLM_CALLS, 5, 5);
            }
        };
    }

    /** A library with a fixed answer, and a flag proving whether it was consulted at all. */
    static final class StubLibrary extends ProductKnowledgeLibraryService {
        private final int documentsSearched;
        private final List<KnowledgePassage> passages;
        boolean searched;

        private StubLibrary(int documentsSearched, List<KnowledgePassage> passages) {
            super(null, null, null);
            this.documentsSearched = documentsSearched;
            this.passages = passages;
        }

        static StubLibrary returning(KnowledgePassage... found) {
            return new StubLibrary(1, List.of(found));
        }

        static StubLibrary empty(int documentsSearched) {
            return new StubLibrary(documentsSearched, List.of());
        }

        @Override
        public KnowledgeSearchResponse search(UUID orgId, UUID productId, String query, int limit) {
            searched = true;
            return new KnowledgeSearchResponse(productId, query, documentsSearched,
                    documentsSearched, passages);
        }
    }

    /** A model that either writes a fixed draft or is off, recording exactly what it was shown. */
    static final class StubModel extends AgentDraftService {
        private final AgentDraftResponseParser.ParsedDraft answer;
        final List<AgentDraftGenerator.Passage> sawKnowledge = new ArrayList<>();
        String sawTitle;
        String sawDetails;

        private StubModel(AgentDraftResponseParser.ParsedDraft answer) {
            super(null, null);
            this.answer = answer;
        }

        static StubModel writing(String title, String comments) {
            return new StubModel(new AgentDraftResponseParser.ParsedDraft("general_reply", title, comments));
        }

        static StubModel disabled() {
            return new StubModel(null);
        }

        @Override
        public boolean isEnabledFor(UUID orgId) {
            return answer != null;
        }

        @Override
        public String versionFor(UUID orgId) {
            return answer == null ? null : "stub-model/v1";
        }

        String sawOrderState;

        // The five-argument form is the one the composer calls; overriding only the four-argument
        // convenience would leave the real implementation running underneath it.
        @Override
        public Optional<AgentDraftResponseParser.ParsedDraft> draft(
                UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
                String orderState) {
            sawTitle = title;
            sawDetails = details;
            sawKnowledge.addAll(knowledge);
            sawOrderState = orderState;
            return Optional.ofNullable(answer);
        }
    }
}
