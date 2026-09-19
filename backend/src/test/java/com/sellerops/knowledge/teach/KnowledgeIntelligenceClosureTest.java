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
 * Knowledge &amp; Intelligence Closure v1 — the Teach loop, seller guidance, and the one knowledge verdict.
 *
 * <p>What is pinned here is the package's whole claim, as behaviour rather than wiring:
 * <ol>
 *   <li><b>A knowledge gap is named, taught once, and the same case then answers.</b></li>
 *   <li><b>The next similar case answers without asking again</b> — the taught sentence is ordinary company knowledge.</li>
 *   <li><b>The investigator and the draft writer cannot disagree</b>: they read the same assessment, before and after.</li>
 *   <li><b>A correction the seller asked to keep comes back</b> as guidance on a later similar case — informing the
 *   reply without grounding a fact.</li>
 *   <li><b>Conflicting figures are resolved toward the higher authority</b>, conservatively: the weaker passage stops
 *   being written from, the grounding that existed still exists, and the conflict is reported.</li>
 * </ol>
 *
 * <p>Hermetic: real repositories, real retrieval, real knowledge writers; the only stub is the drafting model.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class KnowledgeIntelligenceClosureTest {

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
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;
    @Autowired OperationsCaseRepository cases;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository issueEvidence;

    private UUID org;
    private UUID productId;
    private final UUID user = UUID.randomUUID();

    private ProductKnowledgeLibraryService library;
    private SellerOperationsKnowledgeService policies;
    private AnswerMemoryService memory;
    private InquiryEvidenceRetriever retriever;
    private KnowledgeSpineService spine;
    private InquiryKnowledgeAssessor assessor;
    private KnowledgeCandidateService candidates;
    private SellerGuidanceService guidance;
    private InquiryReplyDraftService draftService;

    @BeforeEach
    void setUp() {
        Organization o = new Organization();
        o.setName("지식 마감 QA");
        org = organizations.save(o).getId();
        Product p = new Product();
        p.setOrgId(org);
        p.setName("선바로 일체형 전선몰딩");
        p.setStatus("ACTIVE");
        productId = products.save(p).getId();

        library = new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        policies = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        memory = new AnswerMemoryService(memories, orgChunks, productChunks);
        retriever = new InquiryEvidenceRetriever(products, library, policies, memory,
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(channelOrders, channels,
                        (orgId, channelCode, accountId, rows) -> com.sellerops.coverage.ChannelDataState.OBSERVED_FRESH));
        List<KnowledgeSourceAdapter> adapters = List.of(
                new SellerKnowledgeAdapter(orgSources, orgChunks, productSources, productChunks),
                new ProductFactAdapter(facts), new InquiryAnswerAdapter(memories), new ReviewReplyAdapter(em),
                new SellerDecisionAdapter(em), new SellerGuidanceAdapter(guidanceRows));
        spine = new KnowledgeSpineService(adapters, products, new SourceRefResolver(em), retriever);
        assessor = new InquiryKnowledgeAssessor(retriever, spine, variants, products);
        candidates = new KnowledgeCandidateService(candidateRows, memories, productSources,
                new ProductKnowledgeIndexer(productChunks), products, orgSources, policies, variants);
        guidance = new SellerGuidanceService(guidanceRows);
        draftService = new InquiryReplyDraftService(workItems, draftRows);
    }

    @Test
    @DisplayName("a gap is named, taught once, and the same inquiry then has a grounded draft citing the seller")
    void teachOnceAndTheSameCaseAnswers() {
        InquiryWorkItem work = seedInquiry("방수 되나요?", "욕실에 붙이려는데 방수 되는지 궁금합니다.");
        StubModel model = StubModel.writing("[답변] 방수", "방수 처리가 되어 있어 욕실에도 사용하실 수 있습니다.");

        GeneratedDraftView before = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(before.draft()).as("no basis, no draft — nothing is manufactured").isNull();
        assertThat(before.answerBasis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());
        assertThat(before.knowledgeGap().askedSubject()).isEqualTo("방수");

        assertThat(model.calls).as("a model is not asked to write without a basis").isZero();

        candidates.teach(org, "PRODUCT", productId, before.knowledgeGap().askedSubject(),
                before.knowledgeGap().candidateId(), "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.",
                OrgKnowledgeType.GENERAL_CS_FAQ, user, "판매자");

        GeneratedDraftView after = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(after.answerBasis()).isEqualTo(AnswerBasisState.GROUNDED.name());
        assertThat(after.draft()).isNotNull();
        assertThat(model.sawKnowledge).extracting(AgentDraftGenerator.Passage::text)
                .anySatisfy(text -> assertThat(text).contains("생활 방수"));
        assertThat(after.evidence()).isNotEmpty();
        assertThat(candidateRows.findAllByOrgIdAndStateOrderByEvidenceCountDescCreatedAtDesc(org, "ACCEPTED"))
                .as("the seller's answer is recorded as an accepted candidate").hasSize(1);
        assertThat(productSources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(org, productId))
                .singleElement().extracting(ProductKnowledgeSource::getAuthoredOrigin)
                .isEqualTo(KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);
    }

    @Test
    @DisplayName("the next similar inquiry is answered from the taught knowledge, without asking again")
    void aSecondSimilarCaseReusesTheTaughtKnowledge() {
        InquiryWorkItem first = seedInquiry("방수 되나요?", "욕실에 붙이려는데 방수 되는지 궁금합니다.");
        StubModel model = StubModel.writing("[답변] 방수", "방수 처리가 되어 있습니다.");
        GeneratedDraftView before = composer(model).generateAs(org, first.getId(), "SYSTEM:RESPONSIBILITY");
        candidates.teach(org, "PRODUCT", productId, before.knowledgeGap().askedSubject(),
                before.knowledgeGap().candidateId(), "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.",
                OrgKnowledgeType.GENERAL_CS_FAQ, user, "판매자");

        InquiryWorkItem second = seedInquiry("방수 문의", "주방에도 방수 되나요?");
        StubModel secondModel = StubModel.writing("[답변] 방수", "생활 방수가 되어 주방에도 사용하실 수 있습니다.");
        GeneratedDraftView view = composer(secondModel).generateAs(org, second.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.GROUNDED.name());
        assertThat(view.draft()).isNotNull();
        assertThat(secondModel.sawKnowledge).extracting(AgentDraftGenerator.Passage::text)
                .anySatisfy(text -> assertThat(text).contains("생활 방수"));
        assertThat(candidateRows.findAllByOrgIdAndStateOrderByEvidenceCountDescCreatedAtDesc(org, "OPEN"))
                .as("nothing is asked a second time").isEmpty();
    }

    @Test
    @DisplayName("the investigator and the draft writer read the same verdict — before the teaching and after it")
    void theInvestigatorAndTheDraftCannotDisagree() {
        InquiryWorkItem work = seedInquiry("방수 되나요?", "욕실에 붙이려는데 방수 되는지 궁금합니다.");
        Inquiry inquiry = inquiries.findById(work.getInquiryId()).orElseThrow();
        CaseInvestigationTools.OrgTools tools = tools().forOrg(org);

        CaseInvestigationTools.KnowledgeAssessment before =
                tools.assessKnowledge(OperationsSubjectKind.INQUIRY, inquiry.getId());
        GeneratedDraftView draftBefore = composer(StubModel.writing("제목", "본문"))
                .generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");
        assertThat(before.basis()).isEqualTo(draftBefore.answerBasis()).isEqualTo("NO_ANSWER_BASIS");
        assertThat(before.missingSubject()).isEqualTo(draftBefore.knowledgeGap().askedSubject()).isEqualTo("방수");
        assertThat(before.suggestedScope()).isEqualTo("PRODUCT");
        assertThat(before.evidence()).isEmpty();

        candidates.teach(org, "PRODUCT", productId, "방수", null,
                "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.", OrgKnowledgeType.GENERAL_CS_FAQ, user, "판매자");

        CaseInvestigationTools.KnowledgeAssessment after =
                tools.assessKnowledge(OperationsSubjectKind.INQUIRY, inquiry.getId());
        GeneratedDraftView draftAfter = composer(StubModel.writing("제목", "본문"))
                .generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");
        assertThat(after.basis()).isEqualTo(draftAfter.answerBasis()).isEqualTo("GROUNDED");
        assertThat(after.evidence()).singleElement().satisfies(use -> {
            assertThat(use.authority()).isEqualTo("판매자가 확정한 상품 지식");
            assertThat(use.provenance()).isEqualTo("판매자가 등록한 상품 지식");
            assertThat(use.excerpt()).contains("생활 방수");
        });
        assertThat(tools.calls()).extracting(CaseInvestigationTools.ToolCall::name).contains("assessKnowledge");
    }

    @Test
    @DisplayName("a correction the seller asked to keep comes back as guidance — informing the reply, not grounding it")
    void guidanceIsRetrievedOnALaterSimilarCase() {
        seedPolicy("교환 안내", "상품 수령 후 7일 이내에 교환 신청을 하실 수 있습니다.");
        guidance.record(new SellerGuidanceService.Record(org, productId, SellerGuidance.Kind.DRAFT_CORRECTION,
                "INQUIRY", UUID.randomUUID(), null, "교환 신청 어떻게 하나요",
                "교환 요청은 먼저 사진을 받아 확인한 뒤 안내합니다.", user, "판매자"));

        InquiryWorkItem work = seedInquiry("교환 신청", "교환 신청하려면 어떻게 하나요?");
        Inquiry inquiry = inquiries.findById(work.getInquiryId()).orElseThrow();
        SpineRetrieval found = spine.retrieveForInquiry(org, inquiry, RetrievalQuery.ofCustomer("교환 신청",
                "교환 신청하려면 어떻게 하나요?"), OrderFactLookup.STORED_ONLY,
                com.sellerops.product.library.KnowledgeVariantScope.unresolved());

        assertThat(found.context()).extracting(e -> e.sourceType()).contains(SpineSourceType.SELLER_GUIDANCE);
        assertThat(found.lanes().state().name()).as("guidance is context; the policy is what grounds").isEqualTo("GROUNDED");

        StubModel model = StubModel.writing("[답변] 교환", "사진을 먼저 보내 주시면 확인 후 안내드리겠습니다.");
        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(model.sawKnowledge).extracting(AgentDraftGenerator.Passage::scopeLabel).contains("판매자 지침");
        assertThat(model.sawKnowledge).extracting(AgentDraftGenerator.Passage::text)
                .anySatisfy(text -> assertThat(text).contains("사진을 받아 확인한 뒤"));
        assertThat(view.evidence()).extracting(e -> e.kind()).contains(InquiryDraftEvidence.KIND_SELLER_GUIDANCE);
    }

    @Test
    @DisplayName("conflicting figures resolve toward the higher authority, and the conflict is reported")
    void conflictsResolveTowardTheStrongerAuthority() {
        seedPolicy("교환 안내", "상품 수령 후 7일 이내에 교환 신청을 하실 수 있습니다.");
        memory.remember(new AnswerMemoryService.RememberCommand(org, "inquiry-answer:old",
                AnswerMemoryStrength.IMPORTED_SELLER_ANSWER, "교환 신청 기간", null,
                "교환은 수령 후 30일 이내에 신청해 주시면 됩니다.", null, "NAVER", null, null, null, null, null, null,
                null, null));

        InquiryWorkItem work = seedInquiry("교환 신청", "교환 신청 기간이 어떻게 되나요?");
        Inquiry inquiry = inquiries.findById(work.getInquiryId()).orElseThrow();
        SpineRetrieval found = spine.retrieveForInquiry(org, inquiry,
                RetrievalQuery.ofCustomer("교환 신청", "교환 신청 기간이 어떻게 되나요?"), OrderFactLookup.STORED_ONLY,
                com.sellerops.product.library.KnowledgeVariantScope.unresolved());

        assertThat(found.conflicts()).singleElement().satisfies(conflict -> {
            assertThat(conflict.winnerAuthority().rank()).isLessThan(conflict.loserAuthority().rank());
            assertThat(conflict.winnerTitle()).isEqualTo("교환 안내");
            assertThat(conflict.unit()).isEqualTo("일");
        });
        assertThat(found.lanes().passages()).as("the weaker figure is not written from")
                .noneSatisfy(p -> assertThat(p.text()).contains("30일"));
        assertThat(found.lanes().state().name()).as("grounding that existed still exists").isEqualTo("GROUNDED");

        StubModel model = StubModel.writing("[답변] 교환", "수령 후 7일 이내에 신청해 주세요.");
        composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");
        assertThat(model.sawKnowledge).extracting(AgentDraftGenerator.Passage::text)
                .noneSatisfy(text -> assertThat(text).contains("30일"));
    }

    @Test
    @DisplayName("what the seller teaches and asks to keep belongs to their organisation alone")
    void everythingTaughtIsOrgScoped() {
        Organization other = new Organization();
        other.setName("다른 상점");
        UUID otherOrg = organizations.save(other).getId();
        candidates.teach(org, "ORG", null, "방수", null, "생활 방수가 됩니다.", OrgKnowledgeType.GENERAL_CS_FAQ,
                user, "판매자");
        guidance.record(new SellerGuidanceService.Record(org, null, SellerGuidance.Kind.DECISION_CORRECTION, "INQUIRY",
                UUID.randomUUID(), "REPLY_TO_CUSTOMER", "교환 문의", "이런 건은 사진부터 받습니다.", user, "판매자"));

        assertThat(spine.entries(org, null)).extracting(e -> e.sourceType())
                .contains(SpineSourceType.ORG_KNOWLEDGE, SpineSourceType.SELLER_GUIDANCE);
        assertThat(spine.entries(otherOrg, null)).isEmpty();
        assertThat(spine.search(otherOrg, null, "방수", 10).hits()).isEmpty();
    }

    // ── Past Answer Prefill v1 ──────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Inquiry Claim Guard: the reproduced draft with an invented photo request and follow-up is not saved")
    void theReproducedInventedDraftIsRefused() {
        candidates.teach(org, "PRODUCT", productId, "분리", null,
                com.sellerops.inquiry.draft.InquiryClaimGuardTest.KNOWLEDGE, OrgKnowledgeType.GENERAL_CS_FAQ, user,
                "판매자");
        InquiryWorkItem work = seedInquiry(null, com.sellerops.inquiry.draft.InquiryClaimGuardTest.QUESTION);

        GeneratedDraftView refused = composer(StubModel.writing("분리 방법 안내드립니다",
                com.sellerops.inquiry.draft.InquiryClaimGuardTest.INVENTED))
                .generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(refused.answerBasis()).as("the basis is what it was — grounded").isEqualTo("GROUNDED");
        assertThat(refused.draft()).as("but the invented reply is not saved").isNull();
        assertThat(refused.unavailableMessage()).startsWith("근거에 없는 약속이나 요청");
        assertThat(draftService.currentVersion(work.getId())).isZero();

        GeneratedDraftView clean = composer(StubModel.writing("분리 방법 안내드립니다",
                com.sellerops.inquiry.draft.InquiryClaimGuardTest.CLEAN))
                .generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");
        assertThat(clean.draft()).as("the clean reply of the same question is saved").isNotNull();
        assertThat(clean.unavailableMessage()).isNull();
    }

    @Test
    @DisplayName("a past answer found where no product or policy knowledge was starts the ask — and grounds nothing")
    void aPastAnswerStartsTheAskButGroundsNothing() {
        UUID remembered = rememberAnswer(productId, "방수 되나요",
                "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.");
        InquiryWorkItem work = seedInquiry("방수 되나요?", "욕실에 붙이려는데 방수 되는지 궁금합니다.");
        Inquiry inquiry = inquiries.findById(work.getInquiryId()).orElseThrow();
        StubModel model = StubModel.writing("[답변] 방수", "방수 됩니다.");

        GeneratedDraftView view = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(view.answerBasis()).as("a past answer alone is not a basis").isEqualTo("NO_ANSWER_BASIS");
        assertThat(view.draft()).isNull();
        assertThat(model.calls).isZero();
        assertThat(view.knowledgeGap().precedentMemoryId()).isEqualTo(remembered);
        CaseKnowledgeGap fromDraft = CaseKnowledgeGap.fromDraft(new CaseDraftPreparer.Prepared(false, null,
                view.knowledgeState(), 0, "NO_DRAFT", view.answerBasis(), view.knowledgeGap()));
        assertThat(fromDraft.precedentMemoryId()).isEqualTo(remembered);

        CaseInvestigationTools.KnowledgeAssessment investigated =
                tools().forOrg(org).assessKnowledge(OperationsSubjectKind.INQUIRY, inquiry.getId());
        assertThat(investigated.basis()).isEqualTo("NO_ANSWER_BASIS");
        assertThat(CaseKnowledgeGap.fromInvestigation(investigated).precedentMemoryId())
                .as("the investigation path offers the same precedent").isEqualTo(remembered);

        CaseDetailView.Prefill prefill = CaseKnowledgeService.prefill(org, inquiry.getId(), productId,
                memories.findById(remembered).orElseThrow());
        assertThat(prefill.text()).isEqualTo("제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.");
        assertThat(prefill.strengthKo()).isEqualTo("채널에 등록된 답변");
        assertThat(productSources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(org, productId))
                .as("offering it wrote no knowledge").isEmpty();
    }

    @Test
    @DisplayName("confirming the prefilled past answer teaches it, and the same inquiry then drafts from the knowledge")
    void confirmingThePrefillTeachesAndTheCaseAnswers() {
        UUID remembered = rememberAnswer(productId, "방수 되나요",
                "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.");
        InquiryWorkItem work = seedInquiry("방수 되나요?", "욕실에 붙이려는데 방수 되는지 궁금합니다.");
        StubModel model = StubModel.writing("[답변] 방수", "생활 방수가 되어 욕실에도 쓰실 수 있습니다.");
        GeneratedDraftView before = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");
        String offered = memories.findById(before.knowledgeGap().precedentMemoryId()).orElseThrow().getAnswerBody();

        // The seller edits a few words and saves — the same Teach path an empty box uses.
        candidates.teach(org, "PRODUCT", productId, before.knowledgeGap().askedSubject(),
                before.knowledgeGap().candidateId(), offered.replace("벽면에도", "벽면과 주방에도"),
                OrgKnowledgeType.GENERAL_CS_FAQ, user, "판매자");

        GeneratedDraftView after = composer(model).generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");
        assertThat(after.answerBasis()).isEqualTo("GROUNDED");
        assertThat(after.draft()).isNotNull();
        assertThat(after.knowledgeGap().precedentMemoryId()).as("a grounded case offers nothing to confirm").isNull();
        assertThat(model.sawKnowledge).filteredOn(p -> p.text().contains("벽면과 주방에도")).isNotEmpty();
        assertThat(productSources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(org, productId))
                .singleElement().extracting(ProductKnowledgeSource::getAuthoredOrigin)
                .as("what grounds it is the seller's confirmed knowledge, not the memory")
                .isEqualTo(KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);
        assertThat(memories.findById(remembered).orElseThrow().getAnswerBody())
                .as("the memory itself is untouched").isEqualTo(offered);
    }

    @Test
    @DisplayName("with no past answer the ask is exactly as before: an empty box")
    void noPastAnswerNoPrefill() {
        InquiryWorkItem work = seedInquiry("방수 되나요?", "욕실에 붙이려는데 방수 되는지 궁금합니다.");

        GeneratedDraftView view = composer(StubModel.writing("제목", "본문"))
                .generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(view.answerBasis()).isEqualTo("NO_ANSWER_BASIS");
        assertThat(view.knowledgeGap().askedSubject()).isEqualTo("방수");
        assertThat(view.knowledgeGap().precedentMemoryId()).isNull();
    }

    @Test
    @DisplayName("current knowledge beside a past answer: nothing is offered, because nothing is missing")
    void currentKnowledgeMeansNoPrefill() {
        seedPolicy("교환 안내", "상품 수령 후 7일 이내에 교환 신청을 하실 수 있습니다.");
        rememberAnswer(null, "교환 신청", "교환은 수령 후 7일 안에 신청해 주시면 됩니다.");
        InquiryWorkItem work = seedInquiry("교환 신청", "교환 신청하려면 어떻게 하나요?");

        GeneratedDraftView view = composer(StubModel.writing("[답변] 교환", "7일 이내 신청해 주세요."))
                .generateAs(org, work.getId(), "SYSTEM:RESPONSIBILITY");

        assertThat(view.answerBasis()).isEqualTo("GROUNDED");
        assertThat(view.knowledgeGap().precedentMemoryId()).isNull();
    }

    @Test
    @DisplayName("a precedent is re-checked when shown: another org, another product, this inquiry's own answer, blank")
    void thePrefillIsFencedWhenShown() {
        UUID inquiryId = UUID.randomUUID();
        com.sellerops.knowledge.memory.AnswerMemory m = memories.findById(
                rememberAnswer(productId, "방수 되나요", "생활 방수가 됩니다.")).orElseThrow();

        assertThat(CaseKnowledgeService.prefill(org, inquiryId, productId, m)).isNotNull();
        assertThat(CaseKnowledgeService.prefill(UUID.randomUUID(), inquiryId, productId, m)).isNull();
        assertThat(CaseKnowledgeService.prefill(org, inquiryId, UUID.randomUUID(), m)).isNull();
        assertThat(CaseKnowledgeService.prefill(org, inquiryId, null, m)).isNull();
        m.setOriginInquiryId(inquiryId);
        assertThat(CaseKnowledgeService.prefill(org, inquiryId, productId, m)).isNull();
        m.setOriginInquiryId(null);
        m.setProductId(null);
        assertThat(CaseKnowledgeService.prefill(org, inquiryId, UUID.randomUUID(), m))
                .as("an unbound answer names no product, so it is about none in particular").isNotNull();
        m.setAnswerBody("  ");
        assertThat(CaseKnowledgeService.prefill(org, inquiryId, productId, m)).isNull();
    }

    @Test
    @DisplayName("a case stored before the precedent existed still reads, and a new one round-trips its id")
    void theStoredGapReadsWithAndWithoutAPrecedent() throws Exception {
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        CaseKnowledgeGap old = mapper.readValue("""
                {"basis":"NO_ANSWER_BASIS","missingSubject":"방수","suggestedScope":"PRODUCT","topic":null,
                 "candidateId":null,"source":"DRAFT"}""", CaseKnowledgeGap.class);
        assertThat(old.missingSubject()).isEqualTo("방수");
        assertThat(old.precedentMemoryId()).isNull();

        UUID id = UUID.randomUUID();
        CaseKnowledgeGap now = new CaseKnowledgeGap("NO_ANSWER_BASIS", "방수", "PRODUCT", null, null, "DRAFT", id);
        assertThat(mapper.readValue(mapper.writeValueAsString(now), CaseKnowledgeGap.class)).isEqualTo(now);
    }

    private UUID rememberAnswer(UUID boundProduct, String question, String answer) {
        return memory.remember(new AnswerMemoryService.RememberCommand(org, "inquiry-answer:" + UUID.randomUUID(),
                AnswerMemoryStrength.IMPORTED_SELLER_ANSWER, question, null, answer, boundProduct, "NAVER", null,
                null, UUID.randomUUID(), null, null, null, null, null)).orElseThrow().getId();
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────

    private InquiryDraftComposer composer(StubModel model) {
        return new InquiryDraftComposer(workItems, inquiries, draftService, evidenceRows, retriever, assessor, model,
                allowingQuota(), variants, new DraftEvidenceSnippets(productChunks, orgChunks, memories),
                new com.sellerops.product.detail.ProductDetailEnrichmentTrigger(null, null, null, null, List.of(),
                        false), null, null, null, candidates);
    }

    private CaseInvestigationTools tools() {
        return new CaseInvestigationTools(inquiries, reviews, channels, products, assessor, spine,
                mock(com.sellerops.inquiry.draft.InquiryOrderFactReader.class), issues,
                issueEvidence, cases,
                mock(com.sellerops.inquiry.publish.ReplyDecisionHistoryReader.class));
    }

    private void seedPolicy(String title, String body) {
        policies.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, title, body, null),
                user, "판매자");
    }

    @SuppressWarnings("unused")
    private void seedFact(String key, String value) {
        ProductFact f = new ProductFact();
        f.setOrgId(org);
        f.setProductId(productId);
        f.setFactKey(FactKeys.of(FactKeys.SPEC, key));
        f.setFactValue(value);
        f.setSource("NAVER:PRODUCT_API:v1");
        f.setObservedAt(Instant.parse("2026-09-01T00:00:00Z"));
        f.setConfidence(FactConfidence.SOURCE_STATED);
        facts.save(f);
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

    private static AgentQuotaService allowingQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String idempotencyKey) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
    }

    /** The drafting model, stubbed: these cases are about what it is shown, never about what it writes. */
    static final class StubModel extends AgentDraftService {
        private final AgentDraftResponseParser.ParsedDraft answer;
        final List<AgentDraftGenerator.Passage> sawKnowledge = new java.util.ArrayList<>();
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
            return Optional.ofNullable(answer);
        }
    }
}
