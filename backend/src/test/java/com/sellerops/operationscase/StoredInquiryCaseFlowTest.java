package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOrderBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.inquiry.goal.CustomerGoal;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.GoalRelation;
import com.sellerops.inquiry.goal.Referent;
import com.sellerops.inquiry.goal.RequestBasis;
import com.sellerops.inquiry.goal.RequestedOutcome;
import com.sellerops.inquiry.resolve.CustomerGoalInterpretation;
import com.sellerops.inquiry.resolve.InquiryGoalResolutionService;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.operationscase.dto.CustomerOperationsHomeView;
import com.sellerops.operationscase.investigation.CaseDraftPreparer;
import com.sellerops.operationscase.investigation.CaseInvestigationService;
import com.sellerops.operationscase.investigation.CaseInvestigator;
import com.sellerops.order.ChannelOrder;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.NormalizedOrderStatus;
import com.sellerops.order.fact.OrderStoreFreshness;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
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
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>One stored inquiry, all the way to a case a seller can read.</b>
 *
 * <p>收集된 문의 → Goal → binding → resolution → persisted case → 조회, with no step simulated. The inquiry is a row
 * written through {@link InquiryRepository}; the run, the responsibility and the source observations are the real
 * ones {@link OperationsCaseProcessor} requires; the resolvers are production classes reading production
 * repositories; and the assertion at the end is made against what
 * {@link CustomerOperationsHomeService#home(UUID)} — the seller's own read — hands back.
 *
 * <h2>The one thing that is supplied</h2>
 *
 * <p>{@link CustomerGoalInterpretation}. Reading a sentence into goals is a model's job and that capability has no
 * production caller, so there is no bean to run. This test supplies goals directly, which is the honest shape of
 * the gap: <b>everything downstream of the interpretation is real, and the interpretation is the missing bean.</b>
 *
 * <h2>Zero model calls, zero marketplace calls</h2>
 *
 * <p>The investigation capability is mocked off, so no agent runs — the case is decided by the rules and the
 * deterministic resolution alone, which is the configuration a shipped deployment is in by default. The order
 * reader has no exact readers at all, and everything asks for {@code STORED_ONLY}. Both are asserted, not assumed.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestPropertySource(properties =
        "spring.datasource.url=jdbc:h2:mem:stored_inquiry_case;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
class StoredInquiryCaseFlowTest {

    private static final OrderStoreFreshness FRESH =
            (orgId, channelCode, accountId, rows) -> ChannelDataState.OBSERVED_FRESH;

    @Autowired ResponsibilityRunRepository runs;
    @Autowired ResponsibilityRepository responsibilities;
    @Autowired ResponsibilityRunSourceRepository sourceRows;
    @Autowired OperationsCaseRepository cases;
    @Autowired OperationsCaseEventRepository events;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired ReviewRepository reviews;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired UserRepository users;
    @Autowired ProductRepository products;
    @Autowired ChannelProductRepository listings;
    @Autowired ProductVariantRepository variants;
    @Autowired ChannelOrderRepository orders;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired com.sellerops.inquiry.publish.InquiryExecutionRepository executions;
    @Autowired com.sellerops.inquiry.publish.InquiryVerificationRepository verifications;

    private final CaseInvestigator investigator = mock(CaseInvestigator.class);
    private final CaseInvestigationService investigation = mock(CaseInvestigationService.class);
    private final CaseDraftPreparer drafts = mock(CaseDraftPreparer.class);

    /** What "somebody read this message" would hand over. Swapped per test; null means nobody read it. */
    private final AtomicReference<CustomerGoalSet> interpreted = new AtomicReference<>();

    private UUID org;
    private SellerAccount account;
    private Responsibility responsibility;
    private Instant baseline;
    private int windows;
    private OperationsCaseProcessor processor;
    private CustomerOperationsHomeService home;
    private ProductKnowledgeLibraryService productKnowledge;
    private SellerOperationsKnowledgeService orgKnowledge;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        account = cafe24Account(org);
        User owner = new User();
        owner.setOrgId(org);
        owner.setEmail("owner-" + org + "@example.invalid");
        owner.setName("QA");
        owner.setRole("OWNER");
        owner = users.save(owner);

        responsibility = new Responsibility();
        responsibility.setOrgId(org);
        responsibility.setTemplateCode(ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1);
        responsibility.setTemplateVersion(1);
        responsibility.setStatus(ResponsibilityStatus.ACTIVE);
        responsibility.setNextRunAt(Instant.now().plus(Duration.ofHours(2)));
        responsibility.setActivatedBy(owner.getId());
        responsibility.setActivatedAt(Instant.now().minus(Duration.ofHours(3)));
        responsibility = responsibilities.save(responsibility);
        baseline = Instant.now().minus(Duration.ofHours(1));
        run(baseline);

        productKnowledge = new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        orgKnowledge = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        InquiryEvidenceRetriever retriever = new InquiryEvidenceRetriever(products, productKnowledge, orgKnowledge,
                new AnswerMemoryService(memories, orgChunks, productChunks),
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(orders, channels, FRESH));
        InquiryKnowledgeAssessor assessor = InquiryKnowledgeAssessor.withoutContext(retriever, variants);

        ResponsibilityRollout rollout = ResponsibilityRollout.of(List.of(org));
        processor = new OperationsCaseProcessor(runs, responsibilities, sourceRows,
                new ResponsibilitySources(accounts, channels), rollout, cases, events,
                new OperationsCaseReconciler(cases, events, inquiries, workItems, reviews, accounts,
                        new com.sellerops.inquiry.publish.AnswerDeliveryTruthReader(executions, verifications),
                        Clock.systemUTC()),
                investigator, investigation, drafts, workItems, channels, Clock.systemUTC());
        processor.setResolutions(new CaseResolutionReader(() -> new Supplied(interpreted), inquiries, assessor,
                new InquiryGoalResolutionService(new CapabilityRegistry(channels, listings, variants)),
                Clock.systemUTC()));
        home = new CustomerOperationsHomeService(responsibilities, runs, sourceRows,
                new ResponsibilitySources(accounts, channels), rollout, cases, inquiries, workItems, reviews,
                channels, Clock.systemUTC());

        // No agent. The rules and the deterministic resolution are the whole decision, which is what a shipped
        // deployment does by default — the investigation capability is off unless an org is named.
        when(investigation.isEnabledFor(org)).thenReturn(false);
        when(investigation.maxPerRun()).thenReturn(5);
    }

    // --- the walk --------------------------------------------------------------------------------------------

    @Test
    @DisplayName("ANSWER the company's own rule can close → NEEDS_DECISION, 답변 권고, and the seller reads it")
    void anAnsweredGoalBecomesAReplyRecommendation() {
        orgKnowledge.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY,
                "교환 및 반품 안내", "교환은 수령 후 7일 이내에 신청하실 수 있습니다.", null),
                UUID.randomUUID(), "데모 운영자");
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        workItem(inquiry);
        interpreted.set(set(goal("g1", RequestedOutcome.ANSWER, Referent.ORGANIZATION, "교환 신청 기간이 어떻게 되나요?")));

        processor.process(run(Instant.now()), () -> false);

        OperationsCase c = only();
        assertThat(c.getSubjectId()).isEqualTo(inquiry.getId());
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getRequiredAuthority()).isEqualTo(RequiredAuthority.HUMAN);
        assertThat(c.getDecidedBy()).as("deterministic, not an agent").isEqualTo(CaseDecider.RULE);
        assertThat(c.getRecommendedActionType()).isEqualTo(RecommendedActionType.REPLY_TO_CUSTOMER);
        assertThat(c.getSummary()).isEqualTo("등록된 지식으로 답변할 수 있는 문의입니다.");
        verify(investigator, never()).investigate(any(), any());

        // 조회: the seller's own read shows it, with no enum on the screen but the token for the client to route on.
        CustomerOperationsHomeView.DecisionRow row = decisionRow();
        assertThat(row.caseId()).isEqualTo(c.getId());
        assertThat(row.summary()).isEqualTo("등록된 지식으로 답변할 수 있는 문의입니다.");
        assertThat(row.recommendedActionType()).isEqualTo("REPLY_TO_CUSTOMER");
        assertThat(row.decidedBy()).isEqualTo("RULE");
    }

    @Test
    @DisplayName("ANSWER nothing written down decides → NEEDS_DECISION, 지식 추가 권고")
    void anUnansweredGoalAsksTheSeller() {
        Inquiry inquiry = storedInquiry("전선이 몇 가닥까지 들어가나요?", product("선바로 일체형 전선몰딩"), null);
        workItem(inquiry);
        interpreted.set(set(goal("g1", RequestedOutcome.ANSWER, Referent.CURRENT_LISTING,
                "전선이 몇 가닥까지 들어가나요?")));

        processor.process(run(Instant.now()), () -> false);

        OperationsCase c = only();
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getRecommendedActionType()).isEqualTo(RecommendedActionType.ADD_KNOWLEDGE);
        assertThat(c.getSummary()).contains("판매자님의 판단이 필요합니다");
    }

    @Test
    @DisplayName("STATE_READ the store can answer → the listing's own status closes it")
    void aStateReadIsClosedFromStoredRows() {
        UUID productId = product("선바로 일체형 전선몰딩");
        listing(productId, "SALE", Instant.now().minusSeconds(3600));
        Inquiry inquiry = storedInquiry("지금 판매 중인가요?", productId, null);
        workItem(inquiry);
        interpreted.set(set(goal("g1", RequestedOutcome.STATE_READ, Referent.CURRENT_LISTING, "지금 판매 중인가요?")));

        processor.process(run(Instant.now()), () -> false);

        assertThat(only().getRecommendedActionType()).isEqualTo(RecommendedActionType.REPLY_TO_CUSTOMER);
        assertThat(only().getSummary()).isEqualTo("등록된 지식으로 답변할 수 있는 문의입니다.");
    }

    @Test
    @DisplayName("STATE_READ on an order under STORED_ONLY is a gap the case states, not one it hides")
    void anOrderStateReadIsAnHonestGap() {
        Inquiry inquiry = storedInquiry("제 주문 발송됐나요?", null, "2026-0001");
        workItem(inquiry);
        seedOrder("2026-0001");
        interpreted.set(set(goal("g1", RequestedOutcome.STATE_READ, Referent.CURRENT_ORDER, "제 주문 발송됐나요?")));

        processor.process(run(Instant.now()), () -> false);

        OperationsCase c = only();
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getRequiredAuthority()).isEqualTo(RequiredAuthority.HUMAN);
        assertThat(c.getRecommendedActionType())
                .as("no action type says «do this yourself on the channel», so none is claimed").isNull();
        assertThat(c.getSummary()).isEqualTo("이 채널에서는 확인할 수 없는 정보라 답변 근거로 쓰지 못했습니다.");
    }

    @Test
    @DisplayName("ACTION → the case says the seller must do it, and nothing was executed")
    void anActionBecomesSellerFollowUp() {
        Inquiry inquiry = storedInquiry("주문 취소해 주세요", null, "2026-0001");
        workItem(inquiry);
        seedOrder("2026-0001");
        String statusBefore = orders.findAll().get(0).getRawStatusCode();
        interpreted.set(set(goal("g1", RequestedOutcome.ACTION, Referent.CURRENT_ORDER, "주문 취소해 주세요")));

        processor.process(run(Instant.now()), () -> false);

        OperationsCase c = only();
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getSummary())
                .isEqualTo("고객이 요청한 처리는 자동으로 실행하지 않습니다. 판매자님이 직접 확인하고 처리해 주세요.");
        assertThat(c.getRecommendedActionType()).isNull();
        assertThat(orders.findAll()).singleElement()
                .satisfies(o -> assertThat(o.getRawStatusCode()).isEqualTo(statusBefore));
        verify(drafts, never()).prepare(any(), any());
    }

    @Test
    @DisplayName("NEEDS_CUSTOMER_INPUT → the case names what to ask, in the customer's terms")
    void anAmbiguousVariantBecomesAQuestionForTheCustomer() {
        UUID productId = product("선바로 일체형 전선몰딩");
        variant(productId, "2호", "SALE");
        variant(productId, "3호", "SALE");
        Inquiry inquiry = storedInquiry("지금 판매 중인가요?", productId, null);
        workItem(inquiry);
        interpreted.set(set(goal("g1", RequestedOutcome.STATE_READ, Referent.CURRENT_LISTING, "지금 판매 중인가요?")));

        processor.process(run(Instant.now()), () -> false);

        OperationsCase c = only();
        assertThat(c.getRecommendedActionType()).isEqualTo(RecommendedActionType.CONTACT_CUSTOMER);
        assertThat(c.getSummary()).isEqualTo("답변하려면 고객에게 먼저 확인할 내용이 있습니다.");
        assertThat(decisionRow().missingInformation()).containsExactly("주문하신 옵션");
    }

    @Test
    @DisplayName("NO_GOAL → an observation, no customer-response work, and no model asked")
    void aMessageThatAskedForNothingMakesNoWork() {
        Inquiry inquiry = storedInquiry("감사합니다", null, null);
        workItem(inquiry);
        interpreted.set(new CustomerGoalSet(List.of(), List.of()));
        when(investigation.isEnabledFor(org)).thenReturn(true);   // even with the agent available

        processor.process(run(Instant.now()), () -> false);

        OperationsCase c = only();
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.MONITORING);
        assertThat(c.getRequiredAuthority()).isEqualTo(RequiredAuthority.AUTO);
        assertThat(c.getRecommendedActionType()).isEqualTo(RecommendedActionType.NO_ACTION);
        assertThat(c.getSummary()).isEqualTo("고객이 답변을 요청한 내용이 없어 답변 작업을 만들지 않았습니다.");
        assertThat(c.getStatus()).as("the observation is kept, not closed").isEqualTo(OperationsCaseStatus.PREPARED);
        verify(investigator, never()).investigate(any(), any());
        assertThat(decisions()).as("nothing waiting on the seller").isZero();
    }

    @Test
    @DisplayName("FALLBACK → the conditional goal is withheld, and the case says so")
    void aCustomerStatedConditionIsWithheld() {
        orgKnowledge.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY,
                "교환 및 반품 안내", "교환은 수령 후 7일 이내에 신청하실 수 있습니다.", null),
                UUID.randomUUID(), "데모 운영자");
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요? 안 되면 환불해 주세요", null, null);
        workItem(inquiry);
        interpreted.set(new CustomerGoalSet(
                List.of(goal("g1", RequestedOutcome.ANSWER, Referent.ORGANIZATION, "교환 신청 기간이 어떻게 되나요?"),
                        goal("g2", RequestedOutcome.ACTION, Referent.CURRENT_ORDER, "안 되면 환불해 주세요")),
                List.of(new GoalRelation(GoalRelation.Kind.FALLBACK, "g1", "g2", "안 되면"))));

        processor.process(run(Instant.now()), () -> false);

        assertThat(only().getSummary())
                .isEqualTo("등록된 지식으로 답변할 수 있는 문의입니다. 고객이 조건을 단 요청 1건은 아직 판단하지 않았습니다.");
        assertThat(only().getRecommendedActionType()).isEqualTo(RecommendedActionType.REPLY_TO_CUSTOMER);
    }

    @Test
    @DisplayName("with nobody reading the message, the case is decided exactly as it was before")
    void noInterpretationChangesNothing() {
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        workItem(inquiry);
        interpreted.set(null);

        processor.process(run(Instant.now()), () -> false);

        OperationsCase c = only();
        assertThat(c.getDisposition()).as("the rules' own verdict, untouched")
                .isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getSummary()).isNull();
        assertThat(c.getRecommendedActionType()).isNull();
        assertThat(c.getReason()).isEqualTo(CaseReason.UNANSWERED_INQUIRY);
    }

    @Test
    @DisplayName("the whole walk is recorded on the case's own history, so the conclusion can be read back")
    void theResolutionIsOnTheCaseHistory() {
        UUID productId = product("선바로 일체형 전선몰딩");
        listing(productId, "SALE", Instant.now().minusSeconds(3600));
        Inquiry inquiry = storedInquiry("지금 판매 중인가요?", productId, null);
        workItem(inquiry);
        interpreted.set(set(goal("g1", RequestedOutcome.STATE_READ, Referent.CURRENT_LISTING, "지금 판매 중인가요?")));

        processor.process(run(Instant.now()), () -> false);

        UUID caseId = only().getId();
        String history = events.findAll().stream().filter(e -> caseId.equals(e.getCaseId()))
                .map(OperationsCaseEvent::getProvenance)
                .filter(p -> p != null && p.contains("resolution")).findFirst().orElse(null);
        assertThat(history).as("the case keeps what the resolution consulted").isNotNull();
        assertThat(history).contains("ENTITY.LISTING").contains("LISTING_SALE_STATUS=SELLING");
        assertThat(history).as("the customer's words are not copied into the history")
                .doesNotContain("지금 판매 중인가요");
    }

    // --- fixtures --------------------------------------------------------------------------------------------

    private CustomerGoalSet set(CustomerGoal... goals) {
        return new CustomerGoalSet(List.of(goals), List.of());
    }

    private static CustomerGoal goal(String id, RequestedOutcome outcome, Referent subject, String request) {
        return new CustomerGoal(id, request, outcome, subject, RequestBasis.STATED, List.of(), request);
    }

    private long decisions() {
        return home.home(org).decisions().total();
    }

    private CustomerOperationsHomeView.DecisionRow decisionRow() {
        CustomerOperationsHomeView view = home.home(org);
        assertThat(view.decisions().rows()).hasSize(1);
        return view.decisions().rows().get(0);
    }

    private OperationsCase only() {
        List<OperationsCase> rows = cases.findAll().stream().filter(c -> org.equals(c.getOrgId())).toList();
        assertThat(rows).hasSize(1);
        return rows.get(0);
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

    private Inquiry storedInquiry(String title, UUID productId, String orderRef) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(account.getChannelId());
        q.setSellerAccountId(account.getId());
        q.setProductId(productId);
        q.setTitle(title);
        q.setBody("문의드립니다.");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.now());
        q.setContentHash(UUID.randomUUID().toString());
        q.setCreatedAt(baseline.plus(Duration.ofMinutes(5)));
        if (orderRef != null) {
            q.setSourceOrderRef(orderRef);
            q.setOrderBinding(InquiryOrderBinding.SOURCE_EXACT.name());
        }
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

    private UUID product(String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }

    private void listing(UUID productId, String sellingStatus, Instant observedAt) {
        ChannelProduct row = new ChannelProduct();
        row.setOrgId(org);
        row.setProductId(productId);
        row.setChannelId(account.getChannelId());
        row.setExternalProductId("EXT-" + UUID.randomUUID());
        row.setSellingStatus(sellingStatus);
        row.setObservedAt(observedAt);
        listings.save(row);
    }

    private void variant(UUID productId, String optionName, String sellingStatus) {
        com.sellerops.product.ProductVariant v = new com.sellerops.product.ProductVariant();
        v.setOrgId(org);
        v.setProductId(productId);
        v.setChannelId(account.getChannelId());
        v.setExternalVariantId("VAR-" + UUID.randomUUID());
        v.setSource("CAFE24:PRODUCT_API:v1");
        v.setOptionName(optionName);
        v.setSellingStatus(sellingStatus);
        v.setObservedAt(Instant.now().minusSeconds(3600));
        variants.save(v);
    }

    private void seedOrder(String externalOrderId) {
        ChannelOrder order = new ChannelOrder();
        order.setOrgId(org);
        order.setSellerAccountId(account.getId());
        order.setChannelId(account.getChannelId());
        order.setExternalOrderId(externalOrderId);
        order.setRawStatusCode("PAYED");
        order.setNormalizedStatus(NormalizedOrderStatus.fromRaw("PAYED"));
        order.setPaymentAmount(10000L);
        order.setSummaryDate(LocalDate.now());
        order.setPaidAt(Instant.now().minusSeconds(86400));
        order.setFirstSeenAt(Instant.now().minusSeconds(86400));
        order.setLastSeenAt(Instant.now().minusSeconds(3600));
        orders.save(order);
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
}
