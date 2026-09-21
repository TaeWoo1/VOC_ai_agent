package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.goal.InquiryGoalProperties;
import com.sellerops.agent.llm.goal.InquiryGoalService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.inquiry.resolve.StoredCustomerGoalInterpretation;
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
import java.util.UUID;
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
 * <b>The production path, end to end, with a fake vendor.</b>
 *
 * <p>stored inquiry → {@code customer-goal-interpreter/v3} → binding → resolution → {@link OperationsCase} →
 * the seller's Home row. Every step is the shipped one: the real capability properties, the real door, the real
 * generator, the real parser, the real store, the real case processor and the real Home read. The only thing
 * replaced is {@link com.sellerops.agent.llm.AgentLlmTransport}, which is the seam that would otherwise cost money
 * — and it counts its calls, so «ask once» is measured rather than described.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestPropertySource(properties =
        "spring.datasource.url=jdbc:h2:mem:goal_production_path;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
class GoalInterpretationProductionPathTest {


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
        ResponsibilityRollout rollout = ResponsibilityRollout.of(List.of(org));
        processor = new OperationsCaseProcessor(runs, responsibilities, sourceRows,
                new ResponsibilitySources(accounts, channels), rollout, cases, events,
                new OperationsCaseReconciler(cases, events, inquiries, workItems, reviews, accounts,
                        new com.sellerops.inquiry.publish.AnswerDeliveryTruthReader(executions, verifications),
                        Clock.systemUTC()),
                investigator, investigation, drafts, workItems, channels, Clock.systemUTC());
        home = new CustomerOperationsHomeService(responsibilities, runs, sourceRows,
                new ResponsibilitySources(accounts, channels), rollout, cases, inquiries, workItems, reviews,
                channels, Clock.systemUTC());

        // No agent. The rules and the deterministic resolution are the whole decision, which is what a shipped
        // deployment does by default — the investigation capability is off unless an org is named.
        when(investigation.isEnabledFor(org)).thenReturn(false);
        when(investigation.maxPerRun()).thenReturn(5);
    }



    private static final OrderStoreFreshness FRESH2 =
            (orgId, channelCode, accountId, rows) -> ChannelDataState.OBSERVED_FRESH;

    /** What the fake vendor answers, and how many times it was asked. */
    private String modelAnswer = "{}";
    private final java.util.List<String> vendorCalls = new java.util.ArrayList<>();

    @Autowired com.sellerops.inquiry.goal.InquiryGoalInterpretationRepository interpretations;

    private final AgentQuotaService quota = mock(AgentQuotaService.class);

    private AgentLlmTransport transport() {
        return (uri, headers, body) -> {
            vendorCalls.add(body);
            String envelope = "{\"choices\":[{\"message\":{\"content\":"
                    + new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(modelAnswer)
                    + "},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":400,"
                    + "\"completion_tokens\":80,\"completion_tokens_details\":{\"reasoning_tokens\":0}}}";
            return new AgentLlmTransport.Response(200, envelope, 42);
        };
    }

    /** The shipped capability, with only the transport replaced. */
    private StoredCustomerGoalInterpretation interpreter(boolean enabled, boolean namedOrg) {
        InquiryGoalProperties properties = new InquiryGoalProperties(enabled, namedOrg ? org.toString() : "",
                "OPENAI", "gpt-test", enabled ? "sk-test-key" : "", 900, "minimal");
        InquiryGoalService door = new InquiryGoalService(properties, transport(),
                new AgentCapabilityAccess("ALLOW_LIST", accounts));
        return new StoredCustomerGoalInterpretation(interpretations, door, quota);
    }

    private void wire(StoredCustomerGoalInterpretation reader) {
        InquiryEvidenceRetriever retriever = new InquiryEvidenceRetriever(products, productKnowledge, orgKnowledge,
                new AnswerMemoryService(memories, orgChunks, productChunks),
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(orders, channels, FRESH2));
        processor.setResolutions(new CaseResolutionReader(() -> reader, inquiries,
                InquiryKnowledgeAssessor.withoutContext(retriever, variants),
                new InquiryGoalResolutionService(new CapabilityRegistry(channels, listings, variants)),
                Clock.systemUTC()));
    }

    /** One ANSWER goal quoting the message below, as v3 would return it. */
    private static final String ANSWER_SET = "{\"goals\":[{\"id\":\"g1\","
            + "\"explicit_request\":\"교환 신청 기간\",\"requested_outcome\":\"ANSWER\","
            + "\"subject\":\"ORGANIZATION\",\"basis\":\"STATED\",\"explicit_constraints\":[],"
            + "\"evidence\":\"교환 신청 기간이 어떻게 되나요?\"}],\"relations\":[]}";

    @org.junit.jupiter.api.BeforeEach
    void allowQuota() {
        when(quota.consume(any(), any(), any())).thenReturn(new QuotaDecision(true, null, 0, 0));
    }

    @Test
    @DisplayName("stored inquiry → v3 → resolution → OperationsCase → Home row, through the shipped classes")
    void theWholePathRuns() {
        policy();
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        workItem(inquiry);
        modelAnswer = ANSWER_SET;
        wire(interpreter(true, true));

        processor.process(run(Instant.now()), () -> false);

        assertThat(vendorCalls).as("one message, one call").hasSize(1);
        OperationsCase c = only();
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getRecommendedActionType()).isEqualTo(RecommendedActionType.REPLY_TO_CUSTOMER);
        assertThat(c.getSummary()).isEqualTo("등록된 지식으로 답변할 수 있는 문의입니다.");
        assertThat(decisionRow().summary()).isEqualTo("등록된 지식으로 답변할 수 있는 문의입니다.");

        // The reading was stored under the contract it was made against.
        var stored = interpretations.findAll().stream().filter(r -> org.equals(r.getOrgId())).toList();
        assertThat(stored).hasSize(1);
        assertThat(stored.get(0).getPromptVersion()).isEqualTo("customer-goal-interpreter/v3");
        assertThat(stored.get(0).getOutcome())
                .isEqualTo(com.sellerops.inquiry.goal.InquiryGoalInterpretation.Outcome.INTERPRETED);
        verify(quota).consume(org, com.sellerops.agent.quota.AgentUsageKind.INTERPRET,
                "inquiry-goal:" + inquiry.getId());
    }

    @Test
    @DisplayName("the same message under the same contract is never asked twice")
    void askedOnce() {
        policy();
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        workItem(inquiry);
        modelAnswer = ANSWER_SET;
        StoredCustomerGoalInterpretation reader = interpreter(true, true);

        assertThat(reader.interpret(org, inquiry)).isPresent();
        assertThat(reader.interpret(org, inquiry)).as("read back from the row").isPresent();
        assertThat(reader.interpret(org, inquiry)).isPresent();
        assertThat(vendorCalls).hasSize(1);
        assertThat(interpretations.findAll().stream().filter(r -> org.equals(r.getOrgId())).toList()).hasSize(1);
    }

    @Test
    @DisplayName("an edited message is a different question, and is read again")
    void anEditedMessageIsANewQuestion() {
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        modelAnswer = ANSWER_SET;
        StoredCustomerGoalInterpretation reader = interpreter(true, true);
        assertThat(reader.interpret(org, inquiry)).isPresent();

        inquiry.setTitle("환불 기간이 어떻게 되나요?");
        inquiries.save(inquiry);
        modelAnswer = ANSWER_SET.replace("교환 신청 기간이 어떻게 되나요?", "환불 기간이 어떻게 되나요?")
                .replace("교환 신청 기간", "환불 기간");
        assertThat(reader.interpret(org, inquiry)).isPresent();
        assertThat(vendorCalls).hasSize(2);
    }

    @Test
    @DisplayName("an answer the contract refuses is recorded once, and never bought twice")
    void aContractRefusalIsRememberedNotRetried() {
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        // A quote the customer never wrote: invention, and the contract refuses it.
        modelAnswer = "{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"환불\","
                + "\"requested_outcome\":\"ACTION\",\"subject\":\"CURRENT_ORDER\",\"basis\":\"STATED\","
                + "\"explicit_constraints\":[],\"evidence\":\"환불해 주세요\"}],\"relations\":[]}";
        StoredCustomerGoalInterpretation reader = interpreter(true, true);

        assertThat(reader.interpret(org, inquiry)).isEmpty();
        assertThat(reader.interpret(org, inquiry)).isEmpty();
        assertThat(vendorCalls).as("the same bytes will refuse again").hasSize(1);
        var stored = interpretations.findAll().stream().filter(r -> org.equals(r.getOrgId())).toList();
        assertThat(stored).hasSize(1);
        assertThat(stored.get(0).getOutcome())
                .isEqualTo(com.sellerops.inquiry.goal.InquiryGoalInterpretation.Outcome.REFUSED);
        assertThat(stored.get(0).getFailure()).isEqualTo("GOAL_EVIDENCE");
    }

    @Test
    @DisplayName("a transport failure establishes nothing — no row, and it may be asked again")
    void aTransportFailureIsNotAnAnswer() {
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        InquiryGoalProperties properties = new InquiryGoalProperties(true, org.toString(), "OPENAI", "gpt-test",
                "sk-test-key", 900, "minimal");
        AgentLlmTransport dead = (uri, headers, body) -> {
            vendorCalls.add(body);
            return new AgentLlmTransport.Response(0, "connection refused", 10);
        };
        StoredCustomerGoalInterpretation reader = new StoredCustomerGoalInterpretation(interpretations,
                new InquiryGoalService(properties, dead, new AgentCapabilityAccess("ALLOW_LIST", accounts)), quota);

        assertThat(reader.interpret(org, inquiry)).isEmpty();
        assertThat(interpretations.findAll().stream().filter(r -> org.equals(r.getOrgId())).toList())
                .as("we did not ask is not there is no answer").isEmpty();
        assertThat(reader.interpret(org, inquiry)).isEmpty();
        assertThat(vendorCalls).hasSize(2);
    }

    @Test
    @DisplayName("with the capability OFF the case is decided exactly as before, and nothing is sent or stored")
    void offChangesNothing() {
        policy();
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        workItem(inquiry);
        modelAnswer = ANSWER_SET;
        wire(interpreter(false, true));

        processor.process(run(Instant.now()), () -> false);

        assertThat(vendorCalls).isEmpty();
        assertThat(interpretations.findAll().stream().filter(r -> org.equals(r.getOrgId())).toList()).isEmpty();
        OperationsCase c = only();
        assertThat(c.getSummary()).as("the rules' own verdict, untouched").isNull();
        assertThat(c.getRecommendedActionType()).isNull();
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getReason()).isEqualTo(CaseReason.UNANSWERED_INQUIRY);
    }

    @Test
    @DisplayName("an org nobody named is not admitted, however loudly the deployment is keyed")
    void anUnnamedOrgIsNotAdmitted() {
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        modelAnswer = ANSWER_SET;

        assertThat(interpreter(true, false).interpret(org, inquiry)).isEmpty();
        assertThat(vendorCalls).isEmpty();
    }

    @Test
    @DisplayName("an exhausted budget sends nothing and stores nothing")
    void anExhaustedBudgetIsNotARefusal() {
        Inquiry inquiry = storedInquiry("교환 신청 기간이 어떻게 되나요?", null, null);
        modelAnswer = ANSWER_SET;
        when(quota.consume(any(), any(), any()))
                .thenReturn(new QuotaDecision(false, QuotaDecision.Reason.DAILY_LLM_CALLS, 200, 200));

        assertThat(interpreter(true, true).interpret(org, inquiry)).isEmpty();
        assertThat(vendorCalls).isEmpty();
        assertThat(interpretations.findAll().stream().filter(r -> org.equals(r.getOrgId())).toList()).isEmpty();
    }

    private void policy() {
        orgKnowledge.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY,
                "교환 및 반품 안내", "교환은 수령 후 7일 이내에 신청하실 수 있습니다.", null),
                UUID.randomUUID(), "데모 운영자");
    }

    // --- fixtures --------------------------------------------------------------------------------------------

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

}
