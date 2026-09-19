package com.sellerops.knowledge.teach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftResponseParser;
import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryProductBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.AnswerBasisState;
import com.sellerops.inquiry.draft.DraftEvidenceSnippets;
import com.sellerops.inquiry.draft.InquiryDraftComposer;
import com.sellerops.inquiry.draft.InquiryDraftEvidence;
import com.sellerops.inquiry.draft.InquiryDraftEvidenceRepository;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.guidance.SellerGuidance;
import com.sellerops.knowledge.guidance.SellerGuidanceRepository;
import com.sellerops.knowledge.guidance.SellerGuidanceService;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.memory.AnswerMemoryStrength;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.spine.SpineRetrieval;
import com.sellerops.knowledge.spine.SpineSourceType;
import com.sellerops.knowledge.spine.SourceRefResolver;
import com.sellerops.knowledge.spine.adapter.InquiryAnswerAdapter;
import com.sellerops.knowledge.spine.adapter.KnowledgeSourceAdapter;
import com.sellerops.knowledge.spine.adapter.ProductFactAdapter;
import com.sellerops.knowledge.spine.adapter.ReviewReplyAdapter;
import com.sellerops.knowledge.spine.adapter.SellerDecisionAdapter;
import com.sellerops.knowledge.spine.adapter.SellerGuidanceAdapter;
import com.sellerops.knowledge.spine.adapter.SellerKnowledgeAdapter;
import com.sellerops.knowledge.teach.dto.CaseDetailView;
import com.sellerops.operationscase.CaseKnowledgeGap;
import com.sellerops.operationscase.OperationsCaseRepository;
import com.sellerops.operationscase.OperationsSubjectKind;
import com.sellerops.operationscase.investigation.CaseDraftPreparer;
import com.sellerops.operationscase.investigation.CaseInvestigationTools;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.FactConfidence;
import com.sellerops.product.FactKeys;
import com.sellerops.product.Product;
import com.sellerops.product.ProductFact;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import jakarta.persistence.EntityManager;
import java.time.Instant;
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
 * Inquiry Decision v2 on the real retrieval, catalogue and draft path — the model that plans and judges is scripted,
 * everything else is production code over a real schema.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryDecisionV2Test {

    @Autowired EntityManager em;
    @Autowired OrganizationRepository organizations;
    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductFactRepository facts;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired KnowledgeCandidateRepository candidateRows;
    @Autowired SellerGuidanceRepository guidanceRows;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryReplyDraftRepository draftRows;
    @Autowired InquiryDraftEvidenceRepository evidenceRows;
    @Autowired ChannelRepository channels;
    @Autowired com.sellerops.product.ChannelProductRepository listings;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;

    private UUID org;
    private UUID productId;
    private final UUID user = UUID.randomUUID();
    private ProductKnowledgeLibraryService library;
    private SellerOperationsKnowledgeService policies;
    private InquiryEvidenceRetriever retriever;
    private InquiryKnowledgeAssessor assessor;
    private KnowledgeCandidateService candidates;
    private InquiryReplyDraftService draftService;
    private com.sellerops.inquiry.decision.InquiryEvidenceCollector collector;

    @BeforeEach
    void setUp() {
        Organization o = new Organization();
        o.setName("결정 v2 QA");
        org = organizations.save(o).getId();
        Product p = new Product();
        p.setOrgId(org);
        p.setName("선바로 일체형 전선몰딩");
        p.setStatus("ACTIVE");
        productId = products.save(p).getId();
        library = new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        policies = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        AnswerMemoryService memory = new AnswerMemoryService(memories, orgChunks, productChunks);
        retriever = new InquiryEvidenceRetriever(products, library, policies, memory,
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(channelOrders, channels,
                        (orgId, channelCode, accountId, rows) -> com.sellerops.coverage.ChannelDataState.OBSERVED_FRESH));
        List<KnowledgeSourceAdapter> adapters = List.of(
                new SellerKnowledgeAdapter(orgSources, orgChunks, productSources, productChunks),
                new ProductFactAdapter(facts), new InquiryAnswerAdapter(memories), new ReviewReplyAdapter(em),
                new SellerDecisionAdapter(em), new SellerGuidanceAdapter(guidanceRows));
        KnowledgeSpineService spine = new KnowledgeSpineService(adapters, products, new SourceRefResolver(em), retriever);
        assessor = new InquiryKnowledgeAssessor(retriever, spine, variants, products);
        collector = new com.sellerops.inquiry.decision.InquiryEvidenceCollector(retriever, productSources,
                productChunks, orgSources, orgChunks, facts, variants, listings, channels);
        candidates = new KnowledgeCandidateService(candidateRows, memories, productSources,
                new ProductKnowledgeIndexer(productChunks), products, orgSources, policies, variants);
        draftService = new InquiryReplyDraftService(workItems, draftRows);
        candidates.teach(org, "PRODUCT", productId, "호수", null,
                "선바로 전선몰딩 내경 너비는 1호 13mm(내경 높이 9mm), 2호 20mm(내경 높이 10mm), 3호 23mm입니다. "
                        + "지름 10mm 전선 두 가닥은 3호부터 가능합니다.", OrgKnowledgeType.GENERAL_CS_FAQ, user, "판매자");
    }

    /**
     * A judge that says what a correct judge would: a need is FULL when a candidate carries the word it names, and
     * everything else is whatever the case under test scripts. It counts calls and keeps what it was shown.
     */
    static final class ScriptedDecision implements com.sellerops.inquiry.decision.InquiryDecisionModel {
        final List<com.sellerops.inquiry.decision.InquiryNeed> needs;
        final java.util.function.BiFunction<com.sellerops.inquiry.decision.InquiryNeed,
                List<com.sellerops.inquiry.decision.EvidenceCandidate>, com.sellerops.inquiry.decision.NeedVerdict> judge;
        boolean enabled = true;
        boolean planFails;
        List<com.sellerops.inquiry.decision.EvidenceCandidate> shown = List.of();
        int calls;

        ScriptedDecision(List<com.sellerops.inquiry.decision.InquiryNeed> needs,
                         java.util.function.BiFunction<com.sellerops.inquiry.decision.InquiryNeed,
                                 List<com.sellerops.inquiry.decision.EvidenceCandidate>,
                                 com.sellerops.inquiry.decision.NeedVerdict> judge) {
            this.needs = needs;
            this.judge = judge;
        }

        @Override
        public boolean enabledFor(UUID orgId) {
            return enabled;
        }

        @Override
        public Answer<List<com.sellerops.inquiry.decision.InquiryNeed>> plan(UUID orgId, String question) {
            calls++;
            return new Answer<>(planFails ? null : needs, new CallCost(1, 1, 1, 1));
        }

        @Override
        public Answer<java.util.Map<String, com.sellerops.inquiry.decision.NeedVerdict>> judge(UUID orgId,
                String question, List<com.sellerops.inquiry.decision.InquiryNeed> planned,
                List<com.sellerops.inquiry.decision.EvidenceCandidate> evidence,
                List<com.sellerops.inquiry.decision.PrecedentCandidate> precedents) {
            calls++;
            shown = evidence;
            java.util.Map<String, com.sellerops.inquiry.decision.NeedVerdict> out = new java.util.LinkedHashMap<>();
            for (com.sellerops.inquiry.decision.InquiryNeed n : planned) {
                out.put(n.id(), judge.apply(n, evidence));
            }
            return new Answer<>(out, new CallCost(1, 1, 1, 1));
        }
    }

    static com.sellerops.inquiry.decision.InquiryNeed need(String id, String ask,
                                                          com.sellerops.inquiry.decision.NeedType type) {
        return new com.sellerops.inquiry.decision.InquiryNeed(id, ask, type, ask);
    }

    /** FULL citing every candidate whose text carries {@code word}, NONE when none does. */
    static com.sellerops.inquiry.decision.NeedVerdict fullIfSaid(com.sellerops.inquiry.decision.InquiryNeed n,
                                                                 List<com.sellerops.inquiry.decision.EvidenceCandidate> e,
                                                                 String word) {
        List<String> ids = e.stream().filter(c -> c.text().contains(word))
                .map(com.sellerops.inquiry.decision.EvidenceCandidate::id).toList();
        return new com.sellerops.inquiry.decision.NeedVerdict(n.id(),
                ids.isEmpty() ? com.sellerops.inquiry.decision.NeedStatus.NONE
                        : com.sellerops.inquiry.decision.NeedStatus.FULL, ids, ids.isEmpty() ? "없음" : null, null,
                List.of());
    }

    @Test
    @DisplayName("R 77a91fab shape — one of three needs covered: no draft is written, the Case is the seller's")
    void partialCoverageNeverDrafts() {
        InquiryWorkItem work = seedInquiry(null, "마감캡은 뚫려있나요? 8.5mm 케이블인데 몇 호가 적당할까요? 엘보 사이즈도요.");
        ScriptedDecision decision = new ScriptedDecision(List.of(
                need("N1", "마감캡 끝이 뚫려 있는지", com.sellerops.inquiry.decision.NeedType.PRODUCT_SPEC),
                need("N2", "8.5mm 케이블에 맞는 호수", com.sellerops.inquiry.decision.NeedType.PRODUCT_COMPATIBILITY),
                need("N3", "엘보 구간에 쓸 사이즈", com.sellerops.inquiry.decision.NeedType.PRODUCT_COMPATIBILITY)),
                (n, e) -> n.id().equals("N2") ? fullIfSaid(n, e, "내경 높이 9mm") : fullIfSaid(n, e, "엘보캡"));
        assessor.setDecision(decision, collector);
        StubModel model = StubModel.writing("안내", "1호를 쓰시면 됩니다.");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(view.answerBasis()).isEqualTo("NO_ANSWER_BASIS");
        assertThat(view.draft()).isNull();
        assertThat(model.calls).as("a partial answer is never drafted").isZero();
        assertThat(view.knowledgeGap().needs()).extracting(com.sellerops.inquiry.draft.dto.NeedCoverageView::status)
                .containsExactly("NONE", "FULL", "NONE");
        assertThat(view.knowledgeGap().askedSubject()).isEqualTo("마감캡 끝이 뚫려 있는지");
        CaseKnowledgeGap fromDraft = CaseKnowledgeGap.fromDraft(new CaseDraftPreparer.Prepared(false, null,
                view.knowledgeState(), 0, "NO_DRAFT", view.answerBasis(), view.knowledgeGap()));
        assertThat(fromDraft.needs()).hasSize(3);
        assertThat(CaseKnowledgeService.teachSubject(fromDraft))
                .isEqualTo("마감캡 끝이 뚫려 있는지 · 엘보 구간에 쓸 사이즈");
    }

    @Test
    @DisplayName("stored catalogue is evidence: an option list answers 「우드 색상 있나요」, and the drafter is shown it")
    void catalogueIsEvidence() {
        seedOption("색상: 우드 / 사이즈: 1호", "SELLING");
        seedOption("색상: 화이트 / 사이즈: 1호", "SUSPENDED");
        InquiryWorkItem work = seedInquiry(null, "우드톤 색상도 있나요?");
        ScriptedDecision decision = new ScriptedDecision(
                List.of(need("N1", "우드톤 색상이 있는지", com.sellerops.inquiry.decision.NeedType.CATALOGUE_AVAILABILITY)),
                (n, e) -> fullIfSaid(n, e, "우드"));
        assessor.setDecision(decision, collector);
        StubModel model = StubModel.writing("안내", "우드 색상도 판매 중입니다.");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(decision.shown).extracting(com.sellerops.inquiry.decision.EvidenceCandidate::label)
                .contains("옵션 목록");
        assertThat(decision.shown).filteredOn(c -> c.label().equals("옵션 목록")).singleElement()
                .satisfies(c -> assertThat(c.text()).contains("화이트 / 사이즈: 1호 (판매 중지)"));
        assertThat(view.answerBasis()).isEqualTo("GROUNDED");
        assertThat(model.sawKnowledge).extracting(AgentDraftGenerator.Passage::heading).containsExactly("옵션 목록");
        assertThat(model.sawScope).contains("우드톤 색상이 있는지");
    }

    @Test
    @DisplayName("S X6a shape — fully answered: GROUNDED, and the rule-based 규격 line still reaches the drafter")
    void fullIsNotClarified() {
        seedOption("사이즈: 1호", "SELLING");
        seedOption("사이즈: 3호", "SELLING");
        InquiryWorkItem work = seedInquiry(null, "지름 10mm 선 두 줄 넣으려면 몇 호가 맞나요?");
        ScriptedDecision decision = new ScriptedDecision(
                List.of(need("N1", "지름 10mm 두 줄에 맞는 호수", com.sellerops.inquiry.decision.NeedType.PRODUCT_COMPATIBILITY)),
                (n, e) -> fullIfSaid(n, e, "3호부터"));
        assessor.setDecision(decision, collector);
        StubModel model = StubModel.writing("안내", "3호부터 가능합니다.");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(view.answerBasis()).isEqualTo("GROUNDED");
        // A GROUNDED decision does not silence the 규격 caution: the real judge was measured calling spec-dependent
        // answers FULL (apr-c8715d20), so the drafter is still told when the listing's 규격 is undetermined.
        assertThat(model.sawSpec).isEqualTo(view.knowledgeGap().applicability() == null ? model.sawSpec
                : com.sellerops.inquiry.draft.SpecApplicability.Applicability.valueOf(view.knowledgeGap().applicability())
                        .messageKo(true, false));
        assertThat(view.knowledgeGap().applicability()).isEqualTo("VARIANT_UNRESOLVED");
    }

    @Test
    @DisplayName("the Claim Guard still stands behind the gate: a GROUNDED decision with an invented promise is refused")
    void claimGuardStillRuns() {
        InquiryWorkItem work = seedInquiry(null, "지름 10mm 선 두 줄 넣으려면 몇 호가 맞나요?");
        ScriptedDecision decision = new ScriptedDecision(
                List.of(need("N1", "지름 10mm 두 줄에 맞는 호수", com.sellerops.inquiry.decision.NeedType.PRODUCT_COMPATIBILITY)),
                (n, e) -> fullIfSaid(n, e, "3호부터"));
        assessor.setDecision(decision, collector);
        StubModel model = StubModel.writing("안내", "3호부터 가능합니다. 사진을 보내주시면 확인 후 안내드리겠습니다.");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(view.answerBasis()).isEqualTo("GROUNDED");
        assertThat(view.draft()).isNull();
        assertThat(view.unavailableMessage()).startsWith("근거에 없는 약속이나 요청");
    }

    @Test
    @DisplayName("no plan: not 「답변 기준이 필요합니다」 but an operational reason, and nothing drafted")
    void noDecisionIsOperational() {
        InquiryWorkItem work = seedInquiry(null, "지름 10mm 선 두 줄 넣으려면 몇 호가 맞나요?");
        ScriptedDecision decision = new ScriptedDecision(List.of(), (n, e) -> null);
        decision.planFails = true;
        assessor.setDecision(decision, collector);
        StubModel model = StubModel.writing("안내", "3호부터 가능합니다.");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(view.answerBasis()).isEqualTo("NO_ANSWER_BASIS");
        assertThat(view.unavailableMessage()).isEqualTo(InquiryDraftComposer.DECISION_UNAVAILABLE);
        assertThat(model.calls).isZero();
    }

    @Test
    @DisplayName("capability off: the assessment is exactly the legacy one, and no decision model is called")
    void offIsLegacy() {
        InquiryWorkItem work = seedInquiry(null, "지름 10mm 선 두 줄 넣으려면 몇 호가 맞나요?");
        ScriptedDecision decision = new ScriptedDecision(List.of(), (n, e) -> null);
        decision.enabled = false;
        assessor.setDecision(decision, collector);
        StubModel model = StubModel.writing("안내", "3호부터 가능합니다.");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(decision.calls).isZero();
        assertThat(view.knowledgeGap() == null || view.knowledgeGap().needs() == null).isTrue();
        assertThat(model.sawScope).as("the v11-shaped call — no scope list").isNull();
    }

    private void seedOption(String name, String status) {
        com.sellerops.product.ProductVariant v = new com.sellerops.product.ProductVariant();
        v.setOrgId(org);
        v.setProductId(productId);
        v.setChannelId(UUID.randomUUID());
        v.setExternalVariantId(UUID.randomUUID().toString());
        v.setOptionName(name);
        v.setSellingStatus(status);
        v.setSource("NAVER:PRODUCT_DETAIL_API:v2");
        v.setObservedAt(Instant.parse("2026-09-01T00:00:00Z"));
        variants.save(v);
    }

    private InquiryWorkItem seedInquiry(String title, String body) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setTitle(title);
        q.setBody(body);
        q.setStatus("UNANSWERED");
        q.setProductId(productId);
        q.setProductBinding(InquiryProductBinding.SOURCE_EXACT.name());
        q.setReceivedAt(Instant.parse("2026-09-17T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();
        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(q.getChannelId());
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        return workItems.save(wi);
    }

    private InquiryDraftComposer composer(StubModel model) {
        return new InquiryDraftComposer(workItems, inquiries, draftService, evidenceRows, retriever, assessor, model,
                allowingQuota(), variants, new DraftEvidenceSnippets(productChunks, orgChunks, memories),
                new com.sellerops.product.detail.ProductDetailEnrichmentTrigger(null, null, null, null, List.of(),
                        false), null, null, null, candidates);
    }

    private static AgentQuotaService allowingQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String idempotencyKey) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
    }

    /** The drafting model, stubbed — both the v11 call and the v12 call with a scope list. */
    static final class StubModel extends AgentDraftService {
        private final AgentDraftResponseParser.ParsedDraft answer;
        final List<AgentDraftGenerator.Passage> sawKnowledge = new java.util.ArrayList<>();
        String sawScope;
        String sawSpec;
        int calls;

        private StubModel(AgentDraftResponseParser.ParsedDraft answer) {
            super(null, null, null);
            this.answer = answer;
        }

        static StubModel writing(String title, String comments) {
            return new StubModel(new AgentDraftResponseParser.ParsedDraft("general_reply", title, comments));
        }

        @Override
        public boolean isEnabledFor(UUID orgId) {
            return true;
        }

        @Override
        public String versionFor(UUID orgId) {
            return "stub-model/v1";
        }

        @Override
        public Optional<AgentDraftResponseParser.ParsedDraft> draft(
                UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
                String orderState, String specScope, String style, String companyContext) {
            calls++;
            sawKnowledge.addAll(knowledge);
            sawSpec = specScope;
            return Optional.ofNullable(answer);
        }

        @Override
        public Optional<AgentDraftResponseParser.ParsedDraft> draft(
                UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
                String orderState, String specScope, String style, String companyContext, String answerScope) {
            calls++;
            sawKnowledge.addAll(knowledge);
            sawSpec = specScope;
            sawScope = answerScope;
            return Optional.ofNullable(answer);
        }
    }
}
