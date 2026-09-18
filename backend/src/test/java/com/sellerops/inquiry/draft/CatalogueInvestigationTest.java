package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryProductBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
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
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.spine.SourceRefResolver;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.FactConfidence;
import com.sellerops.product.FactKeys;
import com.sellerops.product.Product;
import com.sellerops.product.ProductFact;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.catalogue.CatalogueInvestigator;
import com.sellerops.product.catalogue.CatalogueQuestion;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>Catalogue Investigation v1</b> — a question about what the seller sells is answered from the seller's own on-sale
 * catalogue before the seller is asked, and never from anything else.
 *
 * <p>The fixture is the shape of NAVER inquiry 689162087 (2026-09-18): 「종이컵 9oz 크기도 디스펜서 제품 판매하시나요?」,
 * asked on a dispenser listing that states no size, in a catalogue where the other dispensers say 「6.5온스 종이컵전용」.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CatalogueInvestigationTest {

    static final String QUESTION = "종이컵 9oz 크기도 디스펜서 제품 판매하시나요?";

    @Autowired EntityManager em;
    @Autowired OrganizationRepository organizations;
    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductFactRepository facts;
    @Autowired ChannelProductRepository listings;
    @Autowired ChannelRepository channels;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryReplyDraftRepository draftRows;
    @Autowired InquiryDraftEvidenceRepository evidenceRows;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;
    @Autowired com.sellerops.knowledge.candidate.KnowledgeCandidateRepository candidateRows;

    private UUID org;
    private UUID otherOrg;
    private UUID holder;
    private InquiryKnowledgeAssessor assessor;
    private InquiryEvidenceRetriever retriever;

    @BeforeEach
    void seed() {
        org = org("카탈로그 QA");
        otherOrg = org("다른 판매자");
        holder = product(org, "종이컵보관함 수거함 디스펜서 컵 홀더", "SALE");
        UUID only65 = product(org, "원터치 디스펜서 종이컵 보관함", "SALE");
        fact(org, only65, FactKeys.DESC_SUMMARY, "6.5온스 종이컵전용입니다.");
        product(org, "아이러브 9온스 종이컵", "SALE");  // a 9oz CUP is not a 9oz dispenser

        ProductKnowledgeLibraryService library =
                new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        retriever = new InquiryEvidenceRetriever(products, library,
                new SellerOperationsKnowledgeService(orgSources, orgChunks),
                new AnswerMemoryService(memories, orgChunks, productChunks),
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(channelOrders, channels,
                        (o, c, a, r) -> com.sellerops.coverage.ChannelDataState.OBSERVED_FRESH));
        KnowledgeSpineService spine = new KnowledgeSpineService(List.of(), products, new SourceRefResolver(em),
                retriever);
        assessor = new InquiryKnowledgeAssessor(retriever, spine, variants, products);
        assessor.setCatalogue(new CatalogueInvestigator(em, channels, null));
    }

    // ── the question ────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("689162087 parses as a catalogue question: head 디스펜서, target 9oz")
    void parsesTheLiveQuestion() {
        CatalogueQuestion q = CatalogueQuestion.parse("디스펜서 문의", QUESTION,
                w -> Set.of("디스펜서", "종이컵").contains(w)).orElseThrow();
        assertThat(q.head()).isEqualTo("디스펜서");
        assertThat(q.subject()).isEqualTo("9oz 디스펜서");
        assertThat(q.measures()).singleElement().satisfies(m -> assertThat(m.unit()).isEqualTo("oz"));
    }

    @Test
    @DisplayName("a question about THIS product, a question with no target, and an unknown noun are not catalogue questions")
    void notEveryQuestionIsACatalogueQuestion() {
        assertThat(CatalogueQuestion.parse(null, "이 디스펜서에 9온스 컵도 들어가나요?", w -> true)).isEmpty();
        assertThat(CatalogueQuestion.parse(null, "디스펜서 판매하시나요?", w -> true)).isEmpty();
        assertThat(CatalogueQuestion.parse(null, "9oz 텀블러도 판매하시나요?", w -> false)).isEmpty();
    }

    @Test
    @DisplayName("9oz ≡ 9온스 ≡ 9 OZ; 19oz is not 9oz; a negated mention is not a statement")
    void measuresAreNumbersNotSubstrings() {
        CatalogueQuestion q = CatalogueQuestion.parse(null, QUESTION, w -> w.equals("디스펜서")).orElseThrow();
        assertThat(CatalogueQuestion.measuresIn("9 온스 컵 전용").get(0).sameAs(q.measures().get(0))).isTrue();
        assertThat(CatalogueQuestion.measuresIn("19oz 대용량")).noneMatch(m -> m.sameAs(q.measures().get(0)));
        assertThat(CatalogueQuestion.measuresIn("6.5온스").get(0).sameAs(q.measures().get(0))).isFalse();
    }

    // ── the investigation ───────────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("689162087: the catalogue is searched first, finds no 9oz dispenser, and the seller is asked about exactly that")
    void noEvidenceAsksTheSellerAfterSearching() {
        InquiryKnowledgeAssessor.Assessment a = assess(holder, QUESTION);

        assertThat(a.catalogue()).as("the catalogue was investigated").isNotNull();
        assertThat(a.catalogue().grounds()).isFalse();
        assertThat(a.catalogue().candidates()).as("both dispensers were checked; the cup was not").isEqualTo(2);
        assertThat(a.catalogue().otherValue()).singleElement()
                .satisfies(s -> assertThat(s.text()).isEqualTo("6.5온스 종이컵전용입니다."));
        assertThat(a.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
        assertThat(a.missingSubject()).isEqualTo("9oz 디스펜서");
        assertThat(a.gap().catalogueChecked())
                .contains("판매 중인 「디스펜서」 상품 2개")
                .contains("「9oz」에 맞는다고 적힌 상품은 없었습니다")
                .contains("6.5온스 종이컵전용입니다.")
                .contains("판매 여부를 알려 주시면");
    }

    @Test
    @DisplayName("an on-sale dispenser that states 9온스 grounds the answer, citing exactly that product")
    void evidenceGroundsWithTheExactProduct() {
        UUID nine = product(org, "대용량 컵 디스펜서", "SALE");
        fact(org, nine, FactKeys.of(FactKeys.SPEC, "사용 컵"), "9온스 종이컵 전용");

        InquiryKnowledgeAssessor.Assessment a = assess(holder, QUESTION);

        assertThat(a.basis()).isEqualTo(AnswerBasisState.GROUNDED);
        assertThat(a.groundedByCatalogue()).isTrue();
        assertThat(a.catalogue().matches()).singleElement().satisfies(s -> {
            assertThat(s.productId()).isEqualTo(nine);
            assertThat(s.current()).isFalse();
            assertThat(s.text()).isEqualTo("9온스 종이컵 전용");
            assertThat(s.locator()).startsWith("catalogue/NAVER/spec:사용 컵@");
        });
    }

    @Test
    @DisplayName("a 9온스 dispenser that is not on sale, or that refuses 9온스, does not ground; another org's never counts")
    void onlyOnSaleAffirmativeStatementsOfThisOrgGround() {
        UUID ended = product(org, "9온스 컵 디스펜서", "CLOSE");
        UUID refuses = product(org, "슬림 컵 디스펜서", "SALE");
        fact(org, refuses, FactKeys.DESC_SUMMARY, "9온스 컵은 사용할 수 없습니다.");
        UUID foreign = product(otherOrg, "9온스 컵 디스펜서 프리미엄", "SALE");

        InquiryKnowledgeAssessor.Assessment a = assess(holder, QUESTION);

        assertThat(a.catalogue().grounds()).isFalse();
        assertThat(a.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
        assertThat(a.catalogue().notOnSale()).extracting(CatalogueInvestigator.Statement::productId)
                .containsExactly(ended);
        assertThat(a.catalogue().negated()).extracting(CatalogueInvestigator.Statement::productId)
                .containsExactly(refuses);
        assertThat(allStatements(a.catalogue())).noneMatch(s -> s.productId().equals(foreign));
    }

    @Test
    @DisplayName("every other word the customer used must be stated: a black cup collector is not a black 하향식 dispenser")
    void qualifiersMustAllBeStated() {
        UUID collector = product(org, "일체형 당겨바 종이컵 수거함 블랙", "SALE");
        fact(org, collector, FactKeys.TAXONOMY_CATEGORY, "생활/건강>주방용품>주방잡화>종이컵디스펜서");
        UUID plainBlack = product(org, "싱글 디스펜서 블랙", "SALE");
        UUID downward = product(org, "하향식 디스펜서 블랙", "SALE");

        InquiryKnowledgeAssessor.Assessment a = assess(holder, "하향식 디스펜서도 판매하시나요? 블랙 색상으로요.");

        assertThat(a.catalogue().question().qualifiers()).containsExactly("하향식");
        assertThat(a.catalogue().matches()).extracting(CatalogueInvestigator.Statement::productId)
                .containsExactly(downward)
                .doesNotContain(collector, plainBlack);
    }

    @Test
    @DisplayName("a question about this product is not answered by another listing that states the value")
    void anotherListingNeverAnswersAQuestionAboutThisOne() {
        UUID nine = product(org, "대용량 컵 디스펜서", "SALE");
        fact(org, nine, FactKeys.of(FactKeys.SPEC, "사용 컵"), "9온스 종이컵 전용");

        InquiryKnowledgeAssessor.Assessment a = assess(holder, "이 디스펜서에 9온스 컵도 들어가나요?");

        assertThat(a.catalogue()).isNull();
        assertThat(a.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
    }

    @Test
    @DisplayName("the draft is written from the catalogue statement, labelled as another product, and cites that product")
    void theDraftCitesTheExactProductSource() {
        UUID nine = product(org, "대용량 컵 디스펜서", "SALE");
        fact(org, nine, FactKeys.of(FactKeys.SPEC, "사용 컵"), "9온스 종이컵 전용");
        InquiryWorkItem work = work(holder, QUESTION);
        InquiryDraftComposerTest.StubModel model =
                InquiryDraftComposerTest.StubModel.writing("[답변] 디스펜서", "대용량 컵 디스펜서가 9온스 종이컵 전용입니다.");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:TEST");

        assertThat(view.answerBasis()).isEqualTo("GROUNDED");
        assertThat(view.knowledgeState()).isEqualTo("GROUNDED");
        assertThat(model.sawKnowledge).singleElement().satisfies(p -> {
            assertThat(p.scopeLabel()).isEqualTo("판매 중인 다른 상품");
            assertThat(p.heading()).isEqualTo("대용량 컵 디스펜서");
            assertThat(p.text()).isEqualTo("9온스 종이컵 전용");
        });
        assertThat(view.evidence()).singleElement().satisfies(e -> {
            assertThat(e.kind()).isEqualTo(InquiryDraftEvidence.KIND_CATALOGUE_PRODUCT);
            assertThat(e.sourceId()).isEqualTo(nine);
            assertThat(e.title()).isEqualTo("대용량 컵 디스펜서");
        });
    }

    @Test
    @DisplayName("with no evidence, no model is called and the screen says what the catalogue was checked for")
    void noEvidenceNoModel() {
        InquiryWorkItem work = work(holder, QUESTION);
        InquiryDraftComposerTest.StubModel model = InquiryDraftComposerTest.StubModel.writing("x", "y");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:TEST");

        assertThat(model.calls).isZero();
        assertThat(view.draft()).isNull();
        assertThat(view.answerBasis()).isEqualTo("NO_ANSWER_BASIS");
        assertThat(view.answerBasisAction()).contains("「9oz」에 맞는다고 적힌 상품은 없었습니다");
        // Filed in 확인 필요 as a catalogue fact for the whole company, in the customer's own words.
        assertThat(view.knowledgeGap().candidateId()).isNotNull();
        com.sellerops.knowledge.candidate.KnowledgeCandidate filed =
                candidateRows.findById(view.knowledgeGap().candidateId()).orElseThrow();
        assertThat(filed.getScope()).isEqualTo("ORG");
        assertThat(filed.getProductId()).isNull();
        assertThat(filed.getContent()).isEqualTo("「9oz 디스펜서」를 판매하시는지 알려 주세요.");
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────

    private InquiryKnowledgeAssessor.Assessment assess(UUID productId, String body) {
        return assessor.assess(org, inquiry(productId, body), OrderFactLookup.STORED_ONLY);
    }

    private InquiryDraftComposer composer(InquiryDraftComposerTest.StubModel model) {
        AgentQuotaService quota = new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String idempotencyKey) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
        return new InquiryDraftComposer(workItems, inquiries, new InquiryReplyDraftService(workItems, draftRows),
                evidenceRows, retriever, assessor, model, quota, variants,
                new DraftEvidenceSnippets(productChunks, orgChunks, memories),
                new com.sellerops.product.detail.ProductDetailEnrichmentTrigger(null, null, null, null, List.of(),
                        false), null, null, null,
                new com.sellerops.knowledge.candidate.KnowledgeCandidateService(candidateRows, memories, productSources,
                        new com.sellerops.product.library.ProductKnowledgeIndexer(productChunks), products, orgSources,
                        new SellerOperationsKnowledgeService(orgSources, orgChunks), variants));
    }

    private static List<CatalogueInvestigator.Statement> allStatements(CatalogueInvestigator.Finding f) {
        List<CatalogueInvestigator.Statement> all = new java.util.ArrayList<>(f.matches());
        all.addAll(f.notOnSale());
        all.addAll(f.otherValue());
        all.addAll(f.negated());
        return all;
    }

    private UUID org(String name) {
        Organization o = new Organization();
        o.setName(name);
        return organizations.save(o).getId();
    }

    private UUID product(UUID orgId, String name, String status) {
        Product p = new Product();
        p.setOrgId(orgId);
        p.setName(name);
        p.setStatus("ACTIVE");
        UUID id = products.save(p).getId();
        ChannelProduct cp = new ChannelProduct();
        cp.setOrgId(orgId);
        cp.setProductId(id);
        cp.setChannelId(naver());
        cp.setExternalProductId("ext-" + id);
        cp.setChannelProductName(name);
        cp.setSellingStatus(status);
        cp.setObservedAt(Instant.parse("2026-09-15T00:00:00Z"));
        cp.setLastSeenAt(Instant.parse("2026-09-15T00:00:00Z"));
        listings.save(cp);
        return id;
    }

    private void fact(UUID orgId, UUID productId, String key, String value) {
        ProductFact f = new ProductFact();
        f.setOrgId(orgId);
        f.setProductId(productId);
        f.setFactKey(key);
        f.setFactValue(value);
        f.setSource("NAVER:PRODUCT_API:v1");
        f.setObservedAt(Instant.parse("2026-09-15T00:00:00Z"));
        f.setConfidence(FactConfidence.SOURCE_STATED);
        facts.save(f);
    }

    private UUID naver() {
        return channels.findByCode("NAVER").map(Channel::getId).orElseGet(() -> {
            Channel c = new Channel();
            c.setCode("NAVER");
            c.setNameKo("네이버");
            c.setStatus(ChannelStatus.CONNECTED);
            return channels.save(c).getId();
        });
    }

    private Inquiry inquiry(UUID productId, String body) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(naver());
        q.setTitle("디스펜서 문의");
        q.setBody(body);
        q.setStatus("UNANSWERED");
        q.setProductId(productId);
        q.setProductBinding(InquiryProductBinding.SOURCE_EXACT.name());
        q.setReceivedAt(Instant.parse("2026-09-17T01:52:31Z"));
        return inquiries.save(q);
    }

    private InquiryWorkItem work(UUID productId, String body) {
        Inquiry q = inquiry(productId, body);
        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(q.getId());
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(q.getChannelId());
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        return workItems.save(wi);
    }
}
