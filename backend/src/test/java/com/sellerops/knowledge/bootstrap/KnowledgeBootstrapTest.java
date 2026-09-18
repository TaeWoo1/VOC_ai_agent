package com.sellerops.knowledge.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.BackfillWindow;
import com.sellerops.collect.SyncRunExecutor;
import com.sellerops.connector.DataType;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryProductBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.AnswerBasisState;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.inquiry.memory.InquiryAnswerMemoryImporter;
import com.sellerops.inquiry.proposal.RuleBasedInquiryProposalProvider;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.guidance.SellerGuidanceRepository;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.spine.SourceRefResolver;
import com.sellerops.knowledge.spine.SpineSourceType;
import com.sellerops.knowledge.spine.adapter.InquiryAnswerAdapter;
import com.sellerops.knowledge.spine.adapter.ProductFactAdapter;
import com.sellerops.knowledge.spine.adapter.ReviewReplyAdapter;
import com.sellerops.knowledge.spine.adapter.SellerDecisionAdapter;
import com.sellerops.knowledge.spine.adapter.SellerGuidanceAdapter;
import com.sellerops.knowledge.spine.adapter.SellerKnowledgeAdapter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.detail.ProductDetailEnrichmentTrigger;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * <b>Customer Ops Product Quality Closure v1 — a fresh seller learns from their operating history.</b>
 *
 * <p>The real path from a NAVER history read to a later case: the connector's canonical rows (answered inquiries with
 * the seller's published answer, weeks older than the routine window) go through the real ingest, the real
 * Answer Memory import and the real Knowledge Spine; a later similar inquiry is assessed by the one assessor the
 * investigator and the draft share. Only the marketplace itself is absent — the rows are what
 * {@code NaverProductQnaClient} maps.
 *
 * <p>And the bootstrap's own orchestration: which accounts it reads, the bounded window it asks for, that a finished
 * read is never repeated, and that nothing is marked done when a run was coalesced or failed.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class KnowledgeBootstrapTest {

    private static final Instant NOW = Instant.parse("2026-09-18T03:00:00Z");

    @Autowired EntityManager em;
    @Autowired OrganizationRepository organizations;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductFactRepository facts;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired SellerGuidanceRepository guidanceRows;
    @Autowired KnowledgeCandidateRepository candidateRows;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;

    private IngestionService ingest;
    private InquiryAnswerMemoryImporter importer;
    private InquiryKnowledgeAssessor assessor;
    private KnowledgeCandidateService candidates;
    private Channel naver;
    private Channel cafe24;

    @BeforeEach
    void wire() {
        naver = channel("NAVER", "네이버 스마트스토어");
        cafe24 = channel("CAFE24", "카페24");
        ingest = new IngestionService(reviews, inquiries, orders, new ProductService(products), communityArticles,
                channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        ProductKnowledgeLibraryService library =
                new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        SellerOperationsKnowledgeService policies = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        AnswerMemoryService memory = new AnswerMemoryService(memories, orgChunks, productChunks);
        importer = new InquiryAnswerMemoryImporter(inquiries, channels, products, memory,
                new RuleBasedInquiryProposalProvider());
        InquiryEvidenceRetriever retriever = new InquiryEvidenceRetriever(products, library, policies, memory,
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(channelOrders, channels,
                        (orgId, code, accountId, rows) -> com.sellerops.coverage.ChannelDataState.OBSERVED_FRESH));
        KnowledgeSpineService spine = new KnowledgeSpineService(List.of(
                new SellerKnowledgeAdapter(orgSources, orgChunks, productSources, productChunks),
                new ProductFactAdapter(facts), new InquiryAnswerAdapter(memories), new ReviewReplyAdapter(em),
                new SellerDecisionAdapter(em), new SellerGuidanceAdapter(guidanceRows)),
                products, new SourceRefResolver(em), retriever);
        assessor = new InquiryKnowledgeAssessor(retriever, spine, variants, products);
        candidates = new KnowledgeCandidateService(candidateRows, memories, productSources,
                new ProductKnowledgeIndexer(productChunks), products, orgSources, policies, variants);
    }

    @Test
    @DisplayName("a fresh seller's past NAVER answers become knowledge a later similar case retrieves — and nothing leaks")
    void historyBecomesKnowledgeForALaterCase() {
        UUID org = org("히스토리 상점");
        UUID account = account(org, naver);
        // What a bounded history read of NAVER 상품 문의 delivers: questions from two months ago, with the answer the
        // seller typed into 스마트스토어 at the time. Older than the 14-day routine window.
        ingest.ingestInquiries(org, naver.getId(), account, List.of(
                answered("Q-100", "선바로 일체형 전선몰딩", "욕실 사용", "욕실 벽에 붙여도 되나요?",
                        "욕실 벽면에도 붙이실 수 있습니다. 물이 직접 닿는 곳은 피해 주세요.", "2026-07-10"),
                answered("Q-101", "선바로 일체형 전선몰딩", "배송", "언제 출고되나요?",
                        "평일 오후 2시 이전 주문은 당일 출고됩니다.", "2026-07-12")));
        int remembered = importer.importCollectedAnswers(org);
        assertThat(remembered).as("both published answers are remembered").isEqualTo(2);
        UUID molding = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getProductId();

        // A later, similar question on the same product: the seller's past answer is retrieved, attributed, and shown
        // as precedent — a past answer alone never grounds today's reply, so the seller is still asked.
        InquiryKnowledgeAssessor.Assessment later = assess(org, molding, "욕실 사용 문의", "욕실 벽에 붙일 수 있나요?");
        List<KnowledgeEntry> pastAnswers = later.spine().evidence().stream()
                .filter(e -> e.sourceType() == SpineSourceType.INQUIRY_ANSWER).toList();
        assertThat(pastAnswers).as("the seller's own past answer is found for the similar question").hasSize(1);
        assertThat(pastAnswers.get(0).text()).contains("욕실 벽면에도 붙이실 수 있습니다");
        assertThat(pastAnswers.get(0).provenance()).isEqualTo("문의 답변 · 채널에 등록된 답변");
        assertThat(pastAnswers.get(0).productId()).isEqualTo(molding);
        assertThat(later.basis()).as("precedent, not a current basis").isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);

        // The seller confirms that past answer as today's basis (the case screen's 「지난 답변을 기준으로 쓰기」) —
        // and the same question is now grounded, citing the seller's current knowledge.
        candidates.teach(org, "PRODUCT", molding, later.missingSubject(), null, pastAnswers.get(0).text(),
                OrgKnowledgeType.GENERAL_CS_FAQ, UUID.randomUUID(), "판매자");
        InquiryKnowledgeAssessor.Assessment confirmed =
                assess(org, molding, "욕실 사용 문의", "욕실 벽에 붙일 수 있나요?");
        assertThat(confirmed.basis()).isEqualTo(AnswerBasisState.GROUNDED);

        // A question nothing in the history speaks to is still a question for the seller — no borrowed evidence.
        InquiryKnowledgeAssessor.Assessment unsupported =
                assess(org, molding, "항균 문의", "항균 처리가 되어 있는 제품인가요?");
        assertThat(unsupported.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
        assertThat(unsupported.spine().evidence()).isEmpty();

        // Another organisation with the same product name and the same question sees none of it.
        UUID other = org("다른 상점");
        Product lookalike = product(other, "선바로 일체형 전선몰딩");
        InquiryKnowledgeAssessor.Assessment foreign =
                assess(other, lookalike.getId(), "욕실 사용 문의", "욕실 벽에 붙일 수 있나요?");
        assertThat(foreign.spine().all()).as("no other organisation's history").isEmpty();

        // Another product of the same seller does not inherit a product-bound answer.
        Product mat = product(org, "논슬립 주방 매트");
        InquiryKnowledgeAssessor.Assessment otherProduct =
                assess(org, mat.getId(), "욕실 사용 문의", "욕실에 깔아도 되나요?");
        assertThat(otherProduct.spine().all()).noneMatch(e -> molding.equals(e.productId()));
    }

    @Test
    @DisplayName("the bootstrap reads each learnable account's history once, over a bounded KST window, and only NAVER")
    void theHistoryReadIsBoundedAndHappensOnce() {
        UUID org = org("부트스트랩 상점");
        UUID naverAccount = account(org, naver);
        account(org, cafe24);
        SyncRunExecutor executor = mock(SyncRunExecutor.class);
        when(executor.execute(eq(org), eq(naverAccount), eq(DataType.INQUIRY), eq("BOOTSTRAP"), any()))
                .thenAnswer(call -> finishedRun(org, naverAccount, "SUCCESS", 41));
        ProductDetailEnrichmentTrigger detail = new ProductDetailEnrichmentTrigger(null, null, null, null, List.of(),
                false);
        KnowledgeBootstrapService bootstrap = service(executor, detail);

        KnowledgeBootstrapService.Report first = bootstrap.bootstrap(org);

        assertThat(first.inquiryHistory()).hasSize(1);
        KnowledgeBootstrapService.InquiryHistory read = first.inquiryHistory().get(0);
        assertThat(read.channelCode()).isEqualTo("NAVER");
        assertThat(read.status()).isEqualTo(KnowledgeBootstrapService.HistoryStatus.READ);
        assertThat(read.rowsRead()).isEqualTo(41);
        verify(executor).execute(org, naverAccount, DataType.INQUIRY, "BOOTSTRAP",
                BackfillWindow.of(LocalDate.parse("2026-06-20"), LocalDate.parse("2026-09-18")));
        assertThat(first.productDetail().enabled()).as("the detail switch is off in this deployment").isFalse();

        // Its SUCCESS row is the marker: a second bootstrap makes no request.
        SyncRunExecutor second = mock(SyncRunExecutor.class);
        KnowledgeBootstrapService.Report again = service(second, detail).bootstrap(org);
        assertThat(again.inquiryHistory().get(0).status())
                .isEqualTo(KnowledgeBootstrapService.HistoryStatus.ALREADY_READ);
        verify(second, never()).execute(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a coalesced or failed history read is not marked done and is tried again")
    void anUnfinishedReadIsNotDone() {
        UUID org = org("재시도 상점");
        UUID naverAccount = account(org, naver);
        SyncRunExecutor executor = mock(SyncRunExecutor.class);
        SyncJob running = new SyncJob();
        running.setStatus("RUNNING");
        when(executor.execute(eq(org), eq(naverAccount), eq(DataType.INQUIRY), eq("BOOTSTRAP"), any()))
                .thenReturn(running);
        ProductDetailEnrichmentTrigger off = new ProductDetailEnrichmentTrigger(null, null, null, null, List.of(),
                false);

        assertThat(service(executor, off).bootstrap(org).inquiryHistory().get(0).status())
                .isEqualTo(KnowledgeBootstrapService.HistoryStatus.IN_PROGRESS);
        assertThat(service(executor, off).lastSuccessfulRead(naverAccount)).isNull();

        when(executor.execute(eq(org), eq(naverAccount), eq(DataType.INQUIRY), eq("BOOTSTRAP"), any()))
                .thenThrow(new IllegalStateException("channel refused"));
        assertThat(service(executor, off).bootstrap(org).inquiryHistory().get(0).status())
                .isEqualTo(KnowledgeBootstrapService.HistoryStatus.FAILED);
    }

    @Test
    @DisplayName("the on-sale catalogue without 상세페이지 text is learned too — never ended listings, never learned ones")
    void onSaleCatalogueDetailIsLearnedBeforeItIsAskedAbout() {
        UUID org = org("카탈로그 상점");
        UUID onSale = listed(org, "판매 중 디스펜서", "SALE");
        UUID ended = listed(org, "판매 종료 디스펜서", "CLOSE");
        UUID learned = listed(org, "상세 읽은 디스펜서", "SALE");
        com.sellerops.product.library.ProductKnowledgeSource doc = new com.sellerops.product.library.ProductKnowledgeSource();
        doc.setOrgId(org);
        doc.setProductId(learned);
        doc.setSourceType(com.sellerops.product.library.KnowledgeSourceType.DESCRIPTION);
        doc.setAuthoredOrigin(com.sellerops.product.library.KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT);
        doc.setTitle("상품 상세페이지");
        doc.setBody("본문");
        productSources.save(doc);
        UUID foreign = listed(org("다른 상점"), "다른 판매자 디스펜서", "SALE");
        KnowledgeBootstrapService bootstrap = service(mock(SyncRunExecutor.class),
                mock(ProductDetailEnrichmentTrigger.class));

        assertThat(bootstrap.onSaleWithoutDetail(org)).as("off unless configured").isEmpty();
        bootstrap.setMaxCatalogueProducts(60);

        assertThat(bootstrap.onSaleWithoutDetail(org)).containsExactly(onSale)
                .doesNotContain(ended, learned, foreign);
    }

    @Test
    @DisplayName("product detail is read for the products customers wrote about, most-discussed first, capped")
    void productDetailFollowsCustomerActivity() {
        UUID org = org("상세 상점");
        UUID account = account(org, naver);
        ingest.ingestInquiries(org, naver.getId(), account, List.of(
                answered("Q-1", "많이 묻는 상품", "t", "b1", "a", "2026-08-01"),
                answered("Q-2", "많이 묻는 상품", "t", "b2", "a", "2026-08-02"),
                answered("Q-3", "가끔 묻는 상품", "t", "b3", "a", "2026-08-03")));
        product(org, "아무도 묻지 않은 상품");
        KnowledgeBootstrapService bootstrap = new KnowledgeBootstrapService(sellerAccounts, channels,
                mock(SyncRunExecutor.class), importer, mock(ProductDetailEnrichmentTrigger.class), products, em,
                Clock.fixed(NOW, ZoneOffset.UTC), 90, 1);

        List<UUID> discussed = bootstrap.discussedProducts(org);

        assertThat(discussed).hasSize(1);
        assertThat(products.findById(discussed.get(0)).orElseThrow().getName()).isEqualTo("많이 묻는 상품");
    }

    @Test
    @DisplayName("a demo-seeded product is not something Reviewnary learned about this company")
    void syntheticProductsNeverReachTheLearnedView() {
        UUID org = org("합성 섞인 상점");
        Product real = product(org, "진짜 상품");
        Product seeded = product(org, "전선몰딩 1호 (합성 샘플)");
        seeded.setDataOrigin(com.sellerops.common.DataOrigin.DEMO_SEED);
        products.save(seeded);
        ProductKnowledgeLibraryService library =
                new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        library.create(org, real.getId(), new com.sellerops.product.library.dto.KnowledgeSourceRequest(
                com.sellerops.product.library.KnowledgeSourceType.FAQ, "부착 안내", "벽지에도 붙습니다.", null),
                UUID.randomUUID(), "판매자");
        library.create(org, seeded.getId(), new com.sellerops.product.library.dto.KnowledgeSourceRequest(
                com.sellerops.product.library.KnowledgeSourceType.FAQ, "두께 안내", "두께는 1.2mm입니다.", null),
                UUID.randomUUID(), "판매자");

        LearnedKnowledgeService.View view =
                new LearnedKnowledgeService(em, sellerAccounts, channels, products).of(org);

        LearnedKnowledgeService.Source material = view.sources().stream()
                .filter(src -> "SELLER_MATERIAL".equals(src.key())).findFirst().orElseThrow();
        assertThat(material.count()).isEqualTo(1);
        assertThat(material.examples()).extracting(LearnedKnowledgeService.Example::productName)
                .containsExactly("진짜 상품");
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────

    @Autowired com.sellerops.product.ChannelProductRepository listingRows;

    private UUID listed(UUID orgId, String name, String status) {
        com.sellerops.product.Product p = new com.sellerops.product.Product();
        p.setOrgId(orgId);
        p.setName(name);
        p.setStatus("ACTIVE");
        UUID id = products.save(p).getId();
        com.sellerops.product.ChannelProduct cp = new com.sellerops.product.ChannelProduct();
        cp.setOrgId(orgId);
        cp.setProductId(id);
        cp.setChannelId(naver.getId());
        cp.setExternalProductId("ext-" + id);
        cp.setSellingStatus(status);
        listingRows.save(cp);
        return id;
    }

    private KnowledgeBootstrapService service(SyncRunExecutor executor, ProductDetailEnrichmentTrigger detail) {
        return new KnowledgeBootstrapService(sellerAccounts, channels, executor, importer, detail, products, em,
                Clock.fixed(NOW, ZoneOffset.UTC), 90, 30);
    }

    private SyncJob finishedRun(UUID org, UUID account, String status, int rows) {
        SyncJob job = new SyncJob();
        job.setOrgId(org);
        job.setSellerAccountId(account);
        job.setChannelId(naver.getId());
        job.setDataType(DataType.INQUIRY.name());
        job.setJobType("SYNC");
        job.setTrigger("BOOTSTRAP");
        job.setStatus(status);
        job.setStartedAt(NOW);
        job.setFinishedAt(NOW);
        job.setSuccessRows(rows);
        em.persist(job);
        em.flush();
        return job;
    }

    private InquiryKnowledgeAssessor.Assessment assess(UUID org, UUID productId, String title, String body) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(naver.getId());
        q.setTitle(title);
        q.setBody(body);
        q.setStatus("UNANSWERED");
        q.setProductId(productId);
        q.setProductBinding(InquiryProductBinding.SOURCE_EXACT.name());
        q.setReceivedAt(NOW);
        return assessor.assess(org, inquiries.save(q), OrderFactLookup.STORED_ONLY);
    }

    private static CanonicalInquiry answered(String id, String product, String title, String body, String answer,
                                             String on) {
        Instant at = LocalDate.parse(on).atStartOfDay(ZoneOffset.UTC).toInstant();
        return new CanonicalInquiry(product, null, null, body, "ANSWERED", at, id, 0, title, null, false,
                "NAVER_PRODUCT_QNA", null, answer, null, null);
    }

    private UUID org(String name) {
        Organization o = new Organization();
        o.setName(name);
        return organizations.save(o).getId();
    }

    private Product product(UUID org, String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setStatus("ACTIVE");
        return products.save(p);
    }

    private UUID account(UUID org, Channel channel) {
        SellerAccount a = new SellerAccount();
        a.setOrgId(org);
        a.setChannelId(channel.getId());
        a.setConnectionStatus(ChannelStatus.CONNECTED);
        a.setFileUpload(false);
        return sellerAccounts.save(a).getId();
    }

    private Channel channel(String code, String name) {
        return channels.findByCode(code).orElseGet(() -> {
            Channel ch = new Channel();
            ch.setCode(code);
            ch.setNameKo(name);
            ch.setStatus(ChannelStatus.AVAILABLE);
            ch.setSupportsInquiry(true);
            ch.setSupportsReview(true);
            ch.setSupportsOrder(true);
            ch.setSupportsSales(true);
            ch.setSupportsProduct(true);
            ch.setSortOrder(0);
            return channels.save(ch);
        });
    }
}
