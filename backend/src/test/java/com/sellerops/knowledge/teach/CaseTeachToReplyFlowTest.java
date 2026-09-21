package com.sellerops.knowledge.teach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftResponseParser;
import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.GlobalExceptionHandler;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.draft.DraftEvidenceSnippets;
import com.sellerops.inquiry.draft.InquiryDraftComposer;
import com.sellerops.inquiry.draft.InquiryDraftEvidenceRepository;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.inquiry.goal.CustomerGoal;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.Referent;
import com.sellerops.inquiry.goal.RequestBasis;
import com.sellerops.inquiry.goal.RequestedOutcome;
import com.sellerops.inquiry.proposal.InquiryProposalRepository;
import com.sellerops.inquiry.proposal.InquiryProposalService;
import com.sellerops.inquiry.proposal.InquiryProposalWriter;
import com.sellerops.inquiry.proposal.RuleBasedInquiryProposalProvider;
import com.sellerops.inquiry.publish.InquiryReplyCapabilityRegistry;
import com.sellerops.inquiry.publish.PreSendCheck;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.resolve.CustomerGoalInterpretation;
import com.sellerops.inquiry.resolve.InquiryGoalResolutionService;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.guidance.SellerGuidanceRepository;
import com.sellerops.knowledge.guidance.SellerGuidanceService;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.spine.SourceRefResolver;
import com.sellerops.knowledge.spine.adapter.InquiryAnswerAdapter;
import com.sellerops.knowledge.spine.adapter.KnowledgeSourceAdapter;
import com.sellerops.knowledge.spine.adapter.ProductFactAdapter;
import com.sellerops.knowledge.spine.adapter.ReviewReplyAdapter;
import com.sellerops.knowledge.spine.adapter.SellerDecisionAdapter;
import com.sellerops.knowledge.spine.adapter.SellerGuidanceAdapter;
import com.sellerops.knowledge.spine.adapter.SellerKnowledgeAdapter;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.CaseEventKind;
import com.sellerops.operationscase.CasePreparedAction;
import com.sellerops.operationscase.CaseResolutionReader;
import com.sellerops.operationscase.CustomerOperationsHomeService;
import com.sellerops.operationscase.OperationsCase;
import com.sellerops.operationscase.OperationsCaseEvent;
import com.sellerops.operationscase.OperationsCaseEventRepository;
import com.sellerops.operationscase.OperationsCaseProcessor;
import com.sellerops.operationscase.OperationsCaseReconciler;
import com.sellerops.operationscase.OperationsCaseRepository;
import com.sellerops.operationscase.RecommendedActionType;
import com.sellerops.operationscase.dto.CustomerOperationsHomeView;
import com.sellerops.operationscase.investigation.CaseDraftPreparer;
import com.sellerops.operationscase.investigation.CaseInvestigationService;
import com.sellerops.operationscase.investigation.CaseInvestigationTools;
import com.sellerops.operationscase.investigation.CaseInvestigator;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.fact.OrderStoreFreshness;
import com.sellerops.order.fact.StoredOnlyOrderFacts;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.detail.ProductDetailEnrichmentTrigger;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.responsibility.IdentityVerdict;
import com.sellerops.responsibility.Responsibility;
import com.sellerops.responsibility.ResponsibilityRepository;
import com.sellerops.responsibility.ResponsibilityRollout;
import com.sellerops.responsibility.ResponsibilityRun;
import com.sellerops.responsibility.ResponsibilityRunRepository;
import com.sellerops.responsibility.ResponsibilityRunSource;
import com.sellerops.responsibility.ResponsibilityRunSourceRepository;
import com.sellerops.responsibility.ResponsibilitySources;
import com.sellerops.responsibility.ResponsibilityStatus;
import com.sellerops.responsibility.ResponsibilityTemplate;
import com.sellerops.responsibility.RunStatus;
import com.sellerops.responsibility.RunTrigger;
import com.sellerops.responsibility.SourceCompleteness;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>ADD_KNOWLEDGE → the seller answers → the same inquiry is a reply with a draft waiting.</b>
 *
 * <p>The loop the case screen promises, driven end to end over the route the screen actually calls:
 * {@code POST /api/responsibilities/customer-operations/cases/{caseId}/teach}. Nothing between the request body and
 * the row is simulated — the knowledge is written by {@link KnowledgeCandidateService#teach}, the re-resolution is
 * the production {@link InquiryGoalResolutionService} reading the production repositories, and the draft is prepared
 * by {@link CaseDraftPreparer} through the same proposal transition and {@link InquiryDraftComposer} a seller's own
 * press runs.
 *
 * <h2>The two things that are supplied, and why</h2>
 *
 * <ol>
 *   <li>{@link CustomerGoalInterpretation} — reading a sentence into goals is a model's job and that capability has
 *   no production bean. Goals are handed over directly, which is the honest shape of the gap: everything downstream
 *   of the interpretation is real.</li>
 *   <li>The drafting model. This case is about <b>whether a draft is prepared at all and on what basis</b>, never
 *   about the sentence a vendor writes.</li>
 * </ol>
 *
 * <p>The investigation capability is off — the configuration a shipped deployment is in by default — so the case is
 * decided by the rules and the deterministic resolution alone, and the investigator's tools are never touched. Zero
 * marketplace calls, zero vendor calls: both are asserted rather than assumed. The work item stops at PROPOSED;
 * nothing here approves, sends, or reaches a channel.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestPropertySource(properties =
        "spring.datasource.url=jdbc:h2:mem:case_teach_loop;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
class CaseTeachToReplyFlowTest {

    private static final OrderStoreFreshness FRESH =
            (orgId, channelCode, accountId, rows) -> ChannelDataState.OBSERVED_FRESH;

    /** What the seller types into [정보 알려주기]. */
    private static final String TAUGHT = "교환은 상품을 받으신 날로부터 7일 이내에 신청하실 수 있습니다.";

    @Autowired EntityManager em;
    @Autowired PlatformTransactionManager txManager;
    @Autowired ResponsibilityRunRepository runs;
    @Autowired ResponsibilityRepository responsibilities;
    @Autowired ResponsibilityRunSourceRepository sourceRows;
    @Autowired OperationsCaseRepository cases;
    @Autowired OperationsCaseEventRepository events;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository workItemAudits;
    @Autowired InquiryProposalRepository proposals;
    @Autowired InquiryReplyDraftRepository draftRows;
    @Autowired InquiryDraftEvidenceRepository evidenceRows;
    @Autowired ReviewRepository reviews;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired UserRepository users;
    @Autowired ProductRepository products;
    @Autowired ProductFactRepository facts;
    @Autowired ChannelProductRepository listings;
    @Autowired ProductVariantRepository variants;
    @Autowired ChannelOrderRepository orders;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired KnowledgeCandidateRepository candidateRows;
    @Autowired SellerGuidanceRepository guidanceRows;
    @Autowired com.sellerops.inquiry.publish.InquiryExecutionRepository executions;
    @Autowired com.sellerops.inquiry.publish.InquiryVerificationRepository verifications;

    /** The investigation is off, so its tools are never reached — asserted at the end of every case. */
    private final CaseInvestigationTools investigationTools = mock(CaseInvestigationTools.class);
    private final CaseInvestigationService investigationService = mock(CaseInvestigationService.class);

    private final AtomicReference<CustomerGoalSet> interpreted = new AtomicReference<>();
    private final StubModel model = StubModel.writing("교환 신청 기간 안내",
            "교환은 상품 수령일로부터 7일 이내에 신청해 주시면 됩니다.");

    private UUID org;
    private UUID userId;
    private SellerAccount account;
    private Responsibility responsibility;
    private Instant baseline;
    private int windows;

    private OperationsCaseProcessor processor;
    private CustomerOperationsHomeService home;
    private CaseKnowledgeService service;
    private SellerOperationsKnowledgeService orgKnowledge;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        account = cafe24Account(org);
        User owner = new User();
        owner.setOrgId(org);
        owner.setEmail("owner-" + org + "@example.invalid");
        owner.setName("데모 운영자");
        owner.setRole("OWNER");
        userId = users.save(owner).getId();

        responsibility = new Responsibility();
        responsibility.setOrgId(org);
        responsibility.setTemplateCode(ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1);
        responsibility.setTemplateVersion(1);
        responsibility.setStatus(ResponsibilityStatus.ACTIVE);
        responsibility.setNextRunAt(Instant.now().plus(Duration.ofHours(2)));
        responsibility.setActivatedBy(userId);
        responsibility.setActivatedAt(Instant.now().minus(Duration.ofHours(3)));
        responsibility = responsibilities.save(responsibility);
        baseline = Instant.now().minus(Duration.ofHours(1));
        run(baseline);

        ProductKnowledgeLibraryService productKnowledge =
                new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        orgKnowledge = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        AnswerMemoryService memory = new AnswerMemoryService(memories, orgChunks, productChunks);
        InquiryEvidenceRetriever retriever = new InquiryEvidenceRetriever(products, productKnowledge, orgKnowledge,
                memory, StoredOnlyOrderFacts.reader(orders, channels, FRESH));
        InquiryKnowledgeAssessor assessor = InquiryKnowledgeAssessor.withoutContext(retriever, variants);
        List<KnowledgeSourceAdapter> adapters = List.of(
                new SellerKnowledgeAdapter(orgSources, orgChunks, productSources, productChunks),
                new ProductFactAdapter(facts), new InquiryAnswerAdapter(memories), new ReviewReplyAdapter(em),
                new SellerDecisionAdapter(em), new SellerGuidanceAdapter(guidanceRows));
        KnowledgeSpineService spine =
                new KnowledgeSpineService(adapters, products, new SourceRefResolver(em), retriever);
        KnowledgeCandidateService candidates = new KnowledgeCandidateService(candidateRows, memories, productSources,
                new ProductKnowledgeIndexer(productChunks), products, orgSources, orgKnowledge, variants);
        InquiryReplyDraftService draftService = new InquiryReplyDraftService(workItems, draftRows);
        DraftEvidenceSnippets snippets = new DraftEvidenceSnippets(productChunks, orgChunks, memories);
        InquiryDraftComposer composer = new InquiryDraftComposer(workItems, inquiries, draftService, evidenceRows,
                retriever, assessor, model, allowingQuota(), variants, snippets,
                new ProductDetailEnrichmentTrigger(null, null, null, null, List.of(), false), null, null, null,
                candidates);

        // The production draft path, whole: the same proposal transition and composer a seller's press runs.
        InquiryProposalService proposalService = new InquiryProposalService(workItems, proposals, inquiries,
                new RuleBasedInquiryProposalProvider(),
                new InquiryProposalWriter(workItems, proposals, workItemAudits, txManager), draftRows, channels,
                products, evidenceRows, fixedTargetState(), new InquiryReplyCapabilityRegistry(),
                StoredOnlyOrderFacts.reader(orders, channels, FRESH), snippets);
        CaseDraftPreparer preparer = new CaseDraftPreparer(proposalService, composer);
        CaseInvestigator investigator =
                new CaseInvestigator(investigationTools, investigationService, allowingQuota());

        ResponsibilityRollout rollout = ResponsibilityRollout.of(List.of(org));
        processor = new OperationsCaseProcessor(runs, responsibilities, sourceRows,
                new ResponsibilitySources(accounts, channels), rollout, cases, events,
                new OperationsCaseReconciler(cases, events, inquiries, workItems, reviews, accounts,
                        new com.sellerops.inquiry.publish.AnswerDeliveryTruthReader(executions, verifications),
                        Clock.systemUTC()),
                investigator, investigationService, preparer, workItems, channels, Clock.systemUTC());
        CaseResolutionReader resolutions = new CaseResolutionReader(() -> new Supplied(interpreted), inquiries,
                assessor, new InquiryGoalResolutionService(new CapabilityRegistry(channels, listings, variants)),
                Clock.systemUTC());
        processor.setResolutions(resolutions);
        home = new CustomerOperationsHomeService(responsibilities, runs, sourceRows,
                new ResponsibilitySources(accounts, channels), rollout, cases, inquiries, workItems, reviews,
                channels, Clock.systemUTC());

        service = new CaseKnowledgeService(cases, events, processor, investigator, preparer, inquiries, reviews,
                channels, products, retriever, candidates, new SellerGuidanceService(guidanceRows), spine,
                draftService, composer, memories);
        service.setResolutions(resolutions);

        mvc = MockMvcBuilders.standaloneSetup(new CaseKnowledgeController(service, users))
                .setControllerAdvice(new GlobalExceptionHandler())
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .build();
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new AuthPrincipal(userId, org, owner.getEmail()), "n/a", List.of()));

        when(investigationService.isEnabledFor(org)).thenReturn(false);
        when(investigationService.maxPerRun()).thenReturn(5);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("POST /teach on an ADD_KNOWLEDGE case: knowledge is stored, the case becomes a reply, a draft waits")
    void teachingTurnsTheCaseIntoAPreparedReply() throws Exception {
        OperationsCase asked = askedCase();
        assertThat(asked.getRecommendedActionType()).isEqualTo(RecommendedActionType.ADD_KNOWLEDGE);
        assertThat(asked.getKnowledgeGap()).as("the ask the seller is about to answer").isNotNull();
        assertThat(asked.getPreparedAction()).isEqualTo(CasePreparedAction.NONE);
        assertThat(asked.getDraftVersion()).isNull();

        mvc.perform(post(teachPath(asked)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"" + TAUGHT + "\",\"scope\":\"ORG\"}"))
                .andExpect(status().isOk())
                // 1. the recommendation moved, on the response the seller's own screen renders
                .andExpect(jsonPath("$.recommendedActionType").value("REPLY_TO_CUSTOMER"))
                .andExpect(jsonPath("$.disposition").value("NEEDS_DECISION"))
                .andExpect(jsonPath("$.decidedBy").value("RULE"))
                .andExpect(jsonPath("$.summary").value("등록된 지식으로 답변할 수 있는 문의입니다."))
                // 2. nothing is still being asked for
                .andExpect(jsonPath("$.gap").doesNotExist())
                // 3. and a draft is waiting, grounded on what was just taught
                .andExpect(jsonPath("$.draft.version").value(1))
                .andExpect(jsonPath("$.draft.answerBasis").value("GROUNDED"))
                .andExpect(jsonPath("$.draft.body").value("교환은 상품 수령일로부터 7일 이내에 신청해 주시면 됩니다."));

        // The knowledge itself: the seller's sentence, written as ordinary company knowledge by the ordinary writer.
        assertThat(taughtSources()).singleElement().satisfies(source -> {
                    assertThat(source.getBody()).isEqualTo(TAUGHT);
                    assertThat(source.getAuthoredOrigin()).isEqualTo(KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);
                });

        // The case row, re-read: NEEDS_SELLER became RESOLVED, and the case carries the prepared draft.
        OperationsCase after = cases.findById(asked.getId()).orElseThrow();
        assertThat(after.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(after.getRecommendedActionType()).isEqualTo(RecommendedActionType.REPLY_TO_CUSTOMER);
        assertThat(after.getKnowledgeGap())
                .as("a question the seller has answered no longer has a gap").isNull();
        assertThat(after.getPreparedAction()).isEqualTo(CasePreparedAction.DRAFT_PREPARED);
        assertThat(after.getDraftVersion()).isEqualTo(1);

        // The seller's home read says the same thing, including that a draft is ready.
        CustomerOperationsHomeView.DecisionRow row = decisionRow();
        assertThat(row.caseId()).isEqualTo(asked.getId());
        assertThat(row.recommendedActionType()).isEqualTo("REPLY_TO_CUSTOMER");
        assertThat(row.draftPrepared()).isTrue();

        // ...and so does GET on the case, so the screen reads the same after a reload.
        mvc.perform(get(casePath(asked)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recommendedActionType").value("REPLY_TO_CUSTOMER"))
                .andExpect(jsonPath("$.gap").doesNotExist())
                .andExpect(jsonPath("$.draft.version").value(1));

        // The history says who did what, in order.
        assertThat(kinds(asked.getId()))
                .containsSubsequence(CaseEventKind.KNOWLEDGE_TAUGHT, CaseEventKind.CONTEXT_UPDATED,
                        CaseEventKind.DRAFT_PREPARED);

        // Prepared is not executed: the work item stops at PROPOSED, and nothing was approved or sent.
        InquiryWorkItem item = workItems.findById(after.getWorkItemId()).orElseThrow();
        assertThat(item.getPhase()).isEqualTo(InquiryWorkItemPhase.PROPOSED);
        assertThat(executions.findAll()).isEmpty();
        assertThat(verifications.findAll()).isEmpty();

        // One vendor call — the draft — and the investigation was never reached.
        assertThat(model.calls).as("the draft is written once; nothing else asks a model").isEqualTo(1);
        verifyNoInteractions(investigationTools);
    }

    @Test
    @DisplayName("the taught sentence is what grounds the draft — the model is shown the seller's own words")
    void theDraftIsGroundedOnWhatTheSellerJustWrote() throws Exception {
        OperationsCase asked = askedCase();

        mvc.perform(post(teachPath(asked)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"" + TAUGHT + "\",\"scope\":\"ORG\"}"))
                .andExpect(status().isOk());

        assertThat(model.sawKnowledge).extracting(AgentDraftGenerator.Passage::text)
                .anySatisfy(text -> assertThat(text).contains("7일 이내"));
        assertThat(draftRows.findAll().stream().filter(d -> org.equals(d.getOrgId())).toList())
                .singleElement().satisfies(d -> assertThat(d.getAnswerBasis()).isEqualTo("GROUNDED"));
        verifyNoInteractions(investigationTools);
    }

    @Test
    @DisplayName("a second seller's case is untouched: the route is scoped to the organisation in the token")
    void anotherOrganisationsCaseIsNotFound() throws Exception {
        OperationsCase asked = askedCase();
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new AuthPrincipal(UUID.randomUUID(), UUID.randomUUID(), "other@example.invalid"), "n/a", List.of()));

        mvc.perform(post(teachPath(asked)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"" + TAUGHT + "\",\"scope\":\"ORG\"}"))
                .andExpect(status().isNotFound());

        assertThat(taughtSources()).as("nothing was written").isEmpty();
        assertThat(cases.findById(asked.getId()).orElseThrow().getRecommendedActionType())
                .isEqualTo(RecommendedActionType.ADD_KNOWLEDGE);
        assertThat(model.calls).isZero();
    }

    @Test
    @DisplayName("an empty answer teaches nothing and leaves the ask standing")
    void anEmptyAnswerIsRefused() throws Exception {
        OperationsCase asked = askedCase();

        mvc.perform(post(teachPath(asked)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"   \",\"scope\":\"ORG\"}"))
                .andExpect(status().isBadRequest());

        assertThat(taughtSources()).isEmpty();
        OperationsCase after = cases.findById(asked.getId()).orElseThrow();
        assertThat(after.getRecommendedActionType()).isEqualTo(RecommendedActionType.ADD_KNOWLEDGE);
        assertThat(after.getKnowledgeGap()).as("the ask is still standing").isNotNull();
        assertThat(model.calls).isZero();
    }

    @Test
    @DisplayName("예약 실행에서도 답할 수 있는 문의는 초안까지 준비된다 — 같은 seam, 판매자 동작 0")
    void aScheduledRunPreparesTheDraftForAResolvedReply() {
        // The library already answers this one, so no Teach happens and nobody presses anything. Before this,
        // the only road to a prepared draft ran through a concluded investigation — which is off by default —
        // so a case the resolvers had fully settled reached the seller saying 「답변할 수 있는 문의입니다」 above
        // an empty draft area.
        orgKnowledge.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY,
                "교환 및 반품 안내", TAUGHT, null), userId, "데모 운영자");
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?");
        workItem(inquiry);
        interpreted.set(new CustomerGoalSet(List.of(new CustomerGoal("g1", "교환 신청 기간이 어떻게 되나요?",
                RequestedOutcome.ANSWER, Referent.ORGANIZATION, RequestBasis.STATED, List.of(),
                "교환 신청 기간이 어떻게 되나요?")), List.of()));

        processor.process(run(Instant.now()), () -> false);

        OperationsCase c = only();
        assertThat(c.getRecommendedActionType()).isEqualTo(RecommendedActionType.REPLY_TO_CUSTOMER);
        assertThat(c.getPreparedAction()).isEqualTo(CasePreparedAction.DRAFT_PREPARED);
        assertThat(c.getDraftVersion()).isEqualTo(1);
        assertThat(c.getKnowledgeGap()).as("nothing is missing, so nothing is asked for").isNull();
        assertThat(draftRows.findAll().stream().filter(d -> org.equals(d.getOrgId())).toList())
                .singleElement().satisfies(d -> assertThat(d.getAnswerBasis()).isEqualTo("GROUNDED"));
        assertThat(decisionRow().draftPrepared()).isTrue();

        // The same boundary the Teach loop stops at: prepared, never executed.
        assertThat(workItems.findById(c.getWorkItemId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.PROPOSED);
        assertThat(executions.findAll()).isEmpty();
        assertThat(model.calls).as("one draft, one call").isEqualTo(1);
        verifyNoInteractions(investigationTools);
    }

    // --- fixtures --------------------------------------------------------------------------------------------

    /** One collected inquiry nothing in the library can answer, walked into a persisted ADD_KNOWLEDGE case. */
    private OperationsCase askedCase() {
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?");
        workItem(inquiry);
        interpreted.set(new CustomerGoalSet(List.of(new CustomerGoal("g1", "교환 신청 기간이 어떻게 되나요?",
                RequestedOutcome.ANSWER, Referent.ORGANIZATION, RequestBasis.STATED, List.of(),
                "교환 신청 기간이 어떻게 되나요?")), List.of()));

        processor.process(run(Instant.now()), () -> false);
        return only();
    }

    private OperationsCase only() {
        List<OperationsCase> rows = cases.findAll().stream().filter(c -> org.equals(c.getOrgId())).toList();
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    /** The company knowledge this organisation holds. Scoped: the schema outlives one test method. */
    private List<OrgKnowledgeSource> taughtSources() {
        return orgSources.findAll().stream().filter(s -> org.equals(s.getOrgId())).toList();
    }

    private String casePath(OperationsCase c) {
        return "/api/responsibilities/customer-operations/cases/" + c.getId();
    }

    private String teachPath(OperationsCase c) {
        return casePath(c) + "/teach";
    }

    private List<CaseEventKind> kinds(UUID caseId) {
        return events.findByOrgIdAndCaseIdOrderByCreatedAtAsc(org, caseId).stream()
                .map(OperationsCaseEvent::getKind).toList();
    }

    private CustomerOperationsHomeView.DecisionRow decisionRow() {
        CustomerOperationsHomeView view = home.home(org);
        assertThat(view.decisions().rows()).hasSize(1);
        return view.decisions().rows().get(0);
    }

    private UUID run(Instant observedAt) {
        Instant window = Instant.parse("2026-01-01T00:00:00Z").plus(Duration.ofHours(2L * windows++));
        ResponsibilityRun run = new ResponsibilityRun();
        run.setOrgId(org);
        run.setResponsibilityId(responsibility.getId());
        run.setTemplateVersion(1);
        run.setWindowStart(window);
        run.setWindowEnd(window.plus(Duration.ofHours(2)));
        run.setRunTrigger(RunTrigger.SCHEDULED);
        run.setAttempt(1);
        run.setStartedAt(observedAt);
        run.setFinishedAt(observedAt);
        run.setStatus(RunStatus.SUCCESS);
        run = runs.save(run);
        source(run, "INQUIRY", observedAt);
        source(run, "REVIEW", observedAt);
        return run.getId();
    }

    private void source(ResponsibilityRun run, String dataType, Instant observedAt) {
        ResponsibilityRunSource row = new ResponsibilityRunSource();
        row.setOrgId(org);
        row.setRunId(run.getId());
        row.setAttempt(1);
        row.setSellerAccountId(account.getId());
        row.setChannelCode("CAFE24");
        row.setDataType(dataType);
        row.setMethod("API");
        row.setWindowFrom(run.getWindowStart());
        row.setWindowTo(run.getWindowEnd());
        row.setStartedAt(observedAt);
        row.setIdentityVerdict(IdentityVerdict.NOT_APPLICABLE);
        row.setCompleteness(SourceCompleteness.COMPLETE);
        row.setObservedAt(observedAt);
        row.setObservedCount(1);
        row.setNewCount(0);
        row.setChangedCount(0);
        sourceRows.save(row);
    }

    private Inquiry storedInquiry(String title) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(account.getChannelId());
        q.setSellerAccountId(account.getId());
        q.setTitle(title);
        q.setBody("문의드립니다.");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.now());
        q.setContentHash(UUID.randomUUID().toString());
        q.setCreatedAt(baseline.plus(Duration.ofMinutes(5)));
        return inquiries.save(q);
    }

    private void workItem(Inquiry inquiry) {
        InquiryWorkItem item = new InquiryWorkItem();
        item.setOrgId(org);
        item.setInquiryId(inquiry.getId());
        item.setSellerAccountId(account.getId());
        item.setChannelId(account.getChannelId());
        item.setPhase(InquiryWorkItemPhase.OPEN);
        workItems.save(item);
    }

    private SellerAccount cafe24Account(UUID orgId) {
        Channel ch = channels.findByCode("CAFE24").orElseGet(() -> {
            Channel c = new Channel();
            c.setCode("CAFE24");
            c.setNameKo("카페24");
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSupportsInquiry(true);
            c.setSupportsReview(true);
            c.setSupportsOrder(true);
            c.setSupportsSales(true);
            c.setSupportsProduct(true);
            c.setSortOrder(0);
            return channels.save(c);
        });
        SellerAccount a = new SellerAccount();
        a.setOrgId(orgId);
        a.setChannelId(ch.getId());
        a.setConnectionStatus(ChannelStatus.CONNECTED);
        a.setFileUpload(false);
        return accounts.save(a);
    }

    private static com.sellerops.inquiry.publish.InquiryTargetStateReader fixedTargetState() {
        return new com.sellerops.inquiry.publish.InquiryTargetStateReader(null, null) {
            @Override
            public PreSendCheck read(UUID orgId, UUID channelId) {
                return PreSendCheck.unproven(PreSendCheck.STATE_UNKNOWN);
            }
        };
    }

    private static AgentQuotaService allowingQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String idempotencyKey) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
    }

    /** The interpretation seam, supplied. Production has no implementation of this interface. */
    private static final class Supplied implements CustomerGoalInterpretation {
        private final AtomicReference<CustomerGoalSet> goals;

        Supplied(AtomicReference<CustomerGoalSet> goals) {
            this.goals = goals;
        }

        @Override
        public Optional<CustomerGoalSet> interpret(UUID orgId, Inquiry inquiry) {
            return Optional.ofNullable(goals.get());
        }
    }

    /** The drafting model, stubbed: this case is about what it is shown, never about what it writes. */
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
