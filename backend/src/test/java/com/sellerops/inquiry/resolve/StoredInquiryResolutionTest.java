package com.sellerops.inquiry.resolve;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOrderBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.ResolutionState;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.goal.CustomerGoal;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.GoalRelation;
import com.sellerops.inquiry.goal.GoalResolution;
import com.sellerops.inquiry.goal.GoalSetResolution;
import com.sellerops.inquiry.goal.Referent;
import com.sellerops.inquiry.goal.RequestBasis;
import com.sellerops.inquiry.goal.RequestedOutcome;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.order.ChannelOrder;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.NormalizedOrderStatus;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.order.fact.OrderFactState;
import com.sellerops.order.fact.OrderStoreFreshness;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariant;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
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
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>A stored inquiry, end to end</b> — goal set → binding → resolver → terminal resolution.
 *
 * <p>Until now every exercise of the resolution loop was a <i>scripted</i> one: the fixtures declare
 * {@code {authority, capability, state}} and the "resolver" hands back the state the fixture already named. That
 * proves the state machine and proves nothing about whether a resolver could exist. This test removes the script.
 * Every row here is written through the production repositories and read back out of them, the resolvers are the
 * production ones, and what they report is decided by what is in the database.
 *
 * <h2>Why this can be a plain {@code @DataJpaTest}</h2>
 *
 * <p>Because nothing in the path needs anything else. The collaborators are constructed by hand from the same
 * repositories production injects, and the two things that must not happen are structural rather than mocked:
 *
 * <ul>
 *   <li><b>Zero marketplace calls</b> — the order reader is built with an empty {@code ExactOrderReaders}, so there
 *       is no channel client to call under any lookup posture, and the default posture is
 *       {@link OrderFactLookup#STORED_ONLY} anyway.</li>
 *   <li><b>Zero model calls</b> — the two knowledge services are constructed through their repository-only
 *       constructors, so the Retrieval v2 embedding / intent / eligibility seams are absent rather than disabled.
 *       Retrieval here is the deterministic lexical path.</li>
 * </ul>
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class StoredInquiryResolutionTest {

    /** The store's own freshness verdict, supplied directly: this test is about resolution, not about coverage. */
    private static final OrderStoreFreshness FRESH =
            (orgId, channelCode, accountId, rows) -> ChannelDataState.OBSERVED_FRESH;

    private static final Instant NOW = Instant.parse("2026-09-21T02:00:00Z");

    @Autowired OrganizationRepository organizations;
    @Autowired InquiryRepository inquiries;
    @Autowired ProductRepository products;
    @Autowired ChannelRepository channels;
    @Autowired ChannelProductRepository listings;
    @Autowired ProductVariantRepository variants;
    @Autowired ChannelOrderRepository orders;
    @Autowired SellerAccountRepository accounts;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;

    private UUID org;
    private UUID channelId;
    private UUID accountId;
    private ProductKnowledgeLibraryService productKnowledge;
    private SellerOperationsKnowledgeService orgKnowledge;
    private InquiryEvidenceRetriever retriever;
    private InquiryGoalResolutionService service;

    @BeforeEach
    void setUp() {
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();

        Channel channel = new Channel();
        channel.setCode("NAVER");
        channel.setNameKo("네이버");
        channel.setStatus(ChannelStatus.CONNECTED);
        channelId = channels.save(channel).getId();

        SellerAccount account = new SellerAccount();
        account.setOrgId(org);
        account.setChannelId(channelId);
        account.setAlias("테스트 계정");
        account.setConnectionStatus(ChannelStatus.CONNECTED);
        accountId = accounts.save(account).getId();

        productKnowledge = new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        orgKnowledge = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        retriever = new InquiryEvidenceRetriever(products, productKnowledge, orgKnowledge,
                new AnswerMemoryService(memories, orgChunks, productChunks),
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(orders, channels, FRESH));
        service = new InquiryGoalResolutionService(new CapabilityRegistry(channels, listings, variants));
    }

    // --- ANSWER ---------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("ANSWER → Knowledge → RESOLVED, from a document the seller actually stored")
    void answerIsClosedByTheSellersOwnProductKnowledge() {
        UUID productId = product("선바로 일체형 전선몰딩");
        productKnowledge.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION,
                "몰딩 규격 안내", "이 몰딩의 내부 폭은 18mm이며, 높이는 10mm입니다.", null),
                UUID.randomUUID(), "데모 운영자");
        UUID inquiryId = storeInquiry(productId, "내부 폭이 몇 mm인가요?", null);

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.ANSWER, Referent.CURRENT_LISTING, "내부 폭이 몇 mm인가요?"));

        assertThat(trace.state()).isEqualTo(ResolutionState.RESOLVED);
        assertThat(trace.observed()).singleElement()
                .satisfies(o -> assertThat(o.resolution().capability()).isEqualTo(CapabilityId.KNOWLEDGE_PRODUCT));
    }

    @Test
    @DisplayName("ANSWER → Knowledge found nothing written down → NEEDS_SELLER, with no SELLER step dispatched")
    void anUnansweredQuestionSettlesOnHumanAuthority() {
        UUID productId = product("선바로 일체형 전선몰딩");
        productKnowledge.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION,
                "몰딩 규격 안내", "이 몰딩의 내부 폭은 18mm이며, 높이는 10mm입니다.", null),
                UUID.randomUUID(), "데모 운영자");
        UUID inquiryId = storeInquiry(productId, "전선이 몇 가닥까지 들어가나요?", null);

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.ANSWER, Referent.CURRENT_LISTING, "전선이 몇 가닥까지 들어가나요?"));

        assertThat(trace.state()).isEqualTo(ResolutionState.NEEDS_SELLER);
        // §10, measured rather than described: the seller is where this ENDS, and nothing is dispatched to reach it.
        assertThat(trace.observed()).singleElement()
                .satisfies(o -> assertThat(o.resolution().capability()).isEqualTo(CapabilityId.KNOWLEDGE_PRODUCT));
        assertThat(trace.observed()).noneMatch(o -> o.resolution().capability() == CapabilityId.SELLER);
    }

    @Test
    @DisplayName("ANSWER about the company is closed by the company's own operating rule")
    void anOrgQuestionIsClosedByThePolicyLane() {
        orgKnowledge.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY,
                "교환 및 반품 안내", "교환은 수령 후 7일 이내에 신청하실 수 있습니다.", null),
                UUID.randomUUID(), "데모 운영자");
        UUID inquiryId = storeInquiry(null, "교환 신청 기간이 어떻게 되나요?", null);

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.ANSWER, Referent.ORGANIZATION, "교환 신청 기간이 어떻게 되나요?"));

        assertThat(trace.state()).isEqualTo(ResolutionState.RESOLVED);
        assertThat(trace.observed()).singleElement()
                .satisfies(o -> assertThat(o.resolution().capability()).isEqualTo(CapabilityId.KNOWLEDGE_ORG));
    }

    @Test
    @DisplayName("a lane that was never searched reports UNAVAILABLE — it does not report an empty library")
    void anUnwiredLaneIsNotAnAbsence() {
        UUID productId = product("선바로 일체형 전선몰딩");
        UUID inquiryId = storeInquiry(productId, "다른 규격도 파시나요?", null);

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.ANSWER, Referent.SELLER_CATALOGUE, "다른 규격도 파시나요?"));

        // The catalogue lane is a separate read this context does not perform. Reporting NEEDS_SELLER here would
        // tell a seller their catalogue has no answer, on the strength of a search that never ran.
        assertThat(trace.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
        assertThat(trace.gap()).isEqualTo(GapReason.UNAVAILABLE);
        assertThat(trace.observed()).singleElement()
                .satisfies(o -> assertThat(o.resolution().capability()).isEqualTo(CapabilityId.KNOWLEDGE_CATALOGUE));
    }

    // --- STATE_READ -----------------------------------------------------------------------------------------------

    @Test
    @DisplayName("STATE_READ → Entity → RESOLVED, from a listing row the channel actually wrote")
    void aListingStateReadIsClosedFromStoredRows() {
        UUID productId = product("선바로 일체형 전선몰딩");
        listing(productId, "SALE", NOW.minusSeconds(3600));
        UUID inquiryId = storeInquiry(productId, "지금 판매 중인가요?", null);

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.STATE_READ, Referent.CURRENT_LISTING, "지금 판매 중인가요?"));

        assertThat(trace.state()).isEqualTo(ResolutionState.RESOLVED);
        assertThat(trace.observed()).singleElement().satisfies(o -> {
            assertThat(o.resolution().capability()).isEqualTo(CapabilityId.ENTITY_LISTING);
            assertThat(o.resolution().observed()).isNotEmpty();
            assertThat(o.resolution().observed().get(0).value()).isEqualTo("SELLING");
        });
    }

    @Test
    @DisplayName("a listing row older than the freshness window resolves to STALE, not to a stale answer")
    void anOldListingRowIsNotCurrentState() {
        UUID productId = product("선바로 일체형 전선몰딩");
        listing(productId, "SALE", NOW.minusSeconds(60 * 60 * 48));
        UUID inquiryId = storeInquiry(productId, "지금 판매 중인가요?", null);

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.STATE_READ, Referent.CURRENT_LISTING, "지금 판매 중인가요?"));

        assertThat(trace.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
        assertThat(trace.gap()).isEqualTo(GapReason.STALE);
    }

    @Test
    @DisplayName("STATE_READ on an order under STORED_ONLY reaches the honest ceiling, not a guess")
    void anOrderStateReadStopsWhereTheStoreStops() {
        UUID inquiryId = storeInquiry(null, "제 주문 발송됐나요?", "2026-0001");
        seedOrder("2026-0001");

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.STATE_READ, Referent.CURRENT_ORDER, "제 주문 발송됐나요?"));

        // The binding worked — the reader found the order the channel named — and the resolver still refuses,
        // because ENTITY_ORDER's required dimension is fulfillment and no stored field carries it.
        assertThat(trace.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
        assertThat(trace.gap()).isEqualTo(GapReason.NOT_SUPPORTED);
        assertThat(trace.observed()).singleElement()
                .satisfies(o -> assertThat(o.resolution().capability()).isEqualTo(CapabilityId.ENTITY_ORDER));
    }

    @Test
    @DisplayName("the order the channel named is the order that was read — binding, not inference")
    void theBoundOrderIsTheOneRead() {
        UUID inquiryId = storeInquiry(null, "제 주문 발송됐나요?", "2026-0001");
        seedOrder("2026-0001");

        InquiryResolutionContext ctx = contextFor(inquiryId);

        assertThat(ctx.orderKey()).contains("2026-0001");
        assertThat(ctx.order().state()).isEqualTo(OrderFactState.OBSERVED_FRESH);
        assertThat(ctx.binds(Referent.CURRENT_ORDER)).isTrue();
    }

    @Test
    @DisplayName("a listing with two options and no option named asks the customer, and stops there")
    void anAmbiguousVariantAsksTheCustomer() {
        UUID productId = product("선바로 일체형 전선몰딩");
        listing(productId, "SALE", NOW.minusSeconds(3600));
        variant(productId, "2호", "SALE", NOW.minusSeconds(3600));
        variant(productId, "3호", "SALE", NOW.minusSeconds(3600));
        UUID inquiryId = storeInquiry(productId, "지금 판매 중인가요?", null);

        // With the listing-level status unavailable, the required dimension falls to the option, and nothing in the
        // goal says which option. The resolver asks rather than picking one.
        listings.deleteAll(listings.findByOrgIdAndProductId(org, productId));
        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.STATE_READ, Referent.CURRENT_LISTING, "지금 판매 중인가요?"));

        assertThat(trace.state()).isEqualTo(ResolutionState.NEEDS_CUSTOMER_INPUT);
        assertThat(trace.observed()).singleElement()
                .satisfies(o -> assertThat(o.resolution().ask())
                        .containsExactly(com.sellerops.inquiry.authority.CustomerInput.OPTION));
    }

    @Test
    @DisplayName("an option the customer did name is matched exactly, and answers about that variant")
    void anExactlyNamedOptionIsRead() {
        UUID productId = product("선바로 일체형 전선몰딩");
        variant(productId, "2호", "SALE", NOW.minusSeconds(3600));
        variant(productId, "3호", "SUSPENSION", NOW.minusSeconds(3600));
        UUID inquiryId = storeInquiry(productId, "3호 지금 판매 중인가요?", null);

        CustomerGoal named = new CustomerGoal("g1", "3호 판매 여부", RequestedOutcome.STATE_READ,
                Referent.CURRENT_LISTING, RequestBasis.STATED, List.of("3호"), "3호 지금 판매 중인가요?");
        GoalResolution.Trace trace = resolveOne(inquiryId, named);

        assertThat(trace.state()).isEqualTo(ResolutionState.RESOLVED);
        assertThat(trace.observed().get(0).resolution().observed().get(0).value()).isEqualTo("SUSPENDED");
    }

    // --- ACTION ---------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("ACTION → Procedure → one dispatch, no work, terminal NOT_EXECUTABLE")
    void anActionTerminatesWithoutReachingAnything() {
        UUID inquiryId = storeInquiry(null, "주문 취소해 주세요", "2026-0001");
        seedOrder("2026-0001");

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.ACTION, Referent.CURRENT_ORDER, "주문 취소해 주세요"));

        assertThat(trace.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
        assertThat(trace.gap()).isEqualTo(GapReason.NOT_EXECUTABLE);
        assertThat(trace.steps()).as("one dispatch, and it is the only one").isEqualTo(1);
        assertThat(trace.observed().get(0).resolution().capability())
                .isEqualTo(CapabilityId.PROCEDURE_ORDER_ACTION);
        assertThat(trace.observed().get(0).prerequisite())
                .as("no precondition, because no observation can make an absent executor present").isNull();
    }

    @Test
    @DisplayName("an ACTION nobody asked for is the same terminal — provenance changes nothing, and nothing runs")
    void anInventedActionIsEquallyInert() {
        UUID inquiryId = storeInquiry(null, "주문 취소해 주세요", "2026-0001");
        seedOrder("2026-0001");
        ChannelOrder before = orders.findAll().get(0);
        String statusBefore = before.getRawStatusCode();

        CustomerGoal invented = new CustomerGoal("g1", "취소", RequestedOutcome.ACTION, Referent.CURRENT_ORDER,
                RequestBasis.DIRECTLY_IMPLIED, List.of(), "주문 취소해 주세요");
        GoalResolution.Trace trace = resolveOne(inquiryId, invented);

        assertThat(trace.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
        assertThat(trace.gap()).isEqualTo(GapReason.NOT_EXECUTABLE);
        assertThat(orders.findAll()).singleElement()
                .satisfies(o -> assertThat(o.getRawStatusCode()).isEqualTo(statusBefore));
    }

    // --- the set: fallback, no goal, unbound ----------------------------------------------------------------------

    @Test
    @DisplayName("FALLBACK: the customer's condition withholds the second goal — no resolver is asked for it")
    void aFallbackIsWithheldNotResolved() {
        orgKnowledge.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY,
                "교환 및 반품 안내", "교환은 수령 후 7일 이내에 신청하실 수 있습니다.", null),
                UUID.randomUUID(), "데모 운영자");
        UUID inquiryId = storeInquiry(null, "교환 신청 기간이 어떻게 되나요? 안 되면 환불해 주세요", null);

        CustomerGoalSet set = new CustomerGoalSet(
                List.of(goal("g1", RequestedOutcome.ANSWER, Referent.ORGANIZATION, "교환 신청 기간이 어떻게 되나요?"),
                        goal("g2", RequestedOutcome.ACTION, Referent.CURRENT_ORDER, "안 되면 환불해 주세요")),
                List.of(new GoalRelation(GoalRelation.Kind.FALLBACK, "g1", "g2", "안 되면")));

        GoalSetResolution.Outcome outcome = resolve(inquiryId, set);

        assertThat(outcome.of("g1").disposition())
                .isEqualTo(GoalSetResolution.Disposition.RESOLVED_INDEPENDENTLY);
        assertThat(outcome.of("g1").trace().state()).isEqualTo(ResolutionState.RESOLVED);
        assertThat(outcome.of("g2").disposition())
                .isEqualTo(GoalSetResolution.Disposition.WITHHELD_FOR_CUSTOMER_STATED_CONDITION);
        assertThat(outcome.of("g2").trace()).as("a withheld goal has no trace because no resolver was asked")
                .isNull();
    }

    @Test
    @DisplayName("NO_GOAL: a message that requested nothing resolves to nothing, and asks nobody")
    void aMessageWithNoGoalDispatchesNothing() {
        UUID inquiryId = storeInquiry(null, "감사합니다", null);

        GoalSetResolution.Outcome outcome = resolve(inquiryId, new CustomerGoalSet(List.of(), List.of()));

        assertThat(outcome.entries()).isEmpty();
        assertThat(outcome.withheld()).isEmpty();
    }

    @Test
    @DisplayName("an unresolved referent never reaches a resolver — the goal names no object to read")
    void anUnboundSubjectIsRefusedBeforeDispatch() {
        UUID inquiryId = storeInquiry(null, "이거 어떻게 되나요?", null);

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.ANSWER, Referent.UNRESOLVED, "이거 어떻게 되나요?"));

        assertThat(trace.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
        assertThat(trace.gap()).isEqualTo(GapReason.UNBOUND);
        assertThat(trace.steps()).isZero();
    }

    @Test
    @DisplayName("a goal about a listing this inquiry has no binding for is a gap, not an answer about nothing")
    void anUnboundProductIsAGap() {
        UUID inquiryId = storeInquiry(null, "이 상품 규격이 어떻게 되나요?", null);

        InquiryResolutionContext ctx = contextFor(inquiryId);
        assertThat(ctx.productId()).isNull();
        assertThat(ctx.binds(Referent.CURRENT_LISTING)).isFalse();

        GoalResolution.Trace trace = resolveOne(inquiryId,
                goal("g1", RequestedOutcome.ANSWER, Referent.CURRENT_LISTING, "이 상품 규격이 어떻게 되나요?"));
        assertThat(trace.state()).isEqualTo(ResolutionState.CAPABILITY_GAP);
        assertThat(trace.gap()).isEqualTo(GapReason.NOT_SUPPORTED);
    }

    // --- the context itself ---------------------------------------------------------------------------------------

    @Test
    @DisplayName("the context is built from the stored row, and the whole set resolves against one of them")
    void oneContextServesEveryGoalInTheSet() {
        UUID productId = product("선바로 일체형 전선몰딩");
        listing(productId, "SALE", NOW.minusSeconds(3600));
        productKnowledge.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION,
                "몰딩 규격 안내", "이 몰딩의 내부 폭은 18mm입니다.", null), UUID.randomUUID(), "데모 운영자");
        UUID inquiryId = storeInquiry(productId, "내부 폭이 몇 mm인가요? 지금 판매 중인가요?", null);

        InquiryResolutionContext ctx = contextFor(inquiryId);
        assertThat(ctx.inquiryId()).isEqualTo(inquiryId);
        assertThat(ctx.productId()).isEqualTo(productId);
        assertThat(ctx.lookup()).isEqualTo(OrderFactLookup.STORED_ONLY);
        assertThat(ctx.searched(CapabilityId.KNOWLEDGE_PRODUCT)).isEqualTo(RetrievalOutcome.FOUND);
        assertThat(ctx.searched(CapabilityId.KNOWLEDGE_CATALOGUE)).as("not searched, so not reported").isNull();

        GoalSetResolution.Outcome outcome = InquiryGoalResolutionService.resolve(new CustomerGoalSet(
                List.of(goal("g1", RequestedOutcome.ANSWER, Referent.CURRENT_LISTING, "내부 폭이 몇 mm인가요?"),
                        goal("g2", RequestedOutcome.STATE_READ, Referent.CURRENT_LISTING, "지금 판매 중인가요?")),
                List.of()), ctx);

        assertThat(outcome.of("g1").trace().state()).isEqualTo(ResolutionState.RESOLVED);
        assertThat(outcome.of("g1").trace().observed().get(0).resolution().capability())
                .isEqualTo(CapabilityId.KNOWLEDGE_PRODUCT);
        assertThat(outcome.of("g2").trace().state()).isEqualTo(ResolutionState.RESOLVED);
        assertThat(outcome.of("g2").trace().observed().get(0).resolution().capability())
                .as("two goals in one set, and each got the resolver its OWN subject names")
                .isEqualTo(CapabilityId.ENTITY_LISTING);
    }

    // --- fixtures ---------------------------------------------------------------------------------------------

    private GoalResolution.Trace resolveOne(UUID inquiryId, CustomerGoal goal) {
        return resolve(inquiryId, new CustomerGoalSet(List.of(goal), List.of())).of(goal.id()).trace();
    }

    private GoalSetResolution.Outcome resolve(UUID inquiryId, CustomerGoalSet set) {
        Inquiry q = stored(inquiryId);
        return service.resolve(org, q, gather(q), set, OrderFactLookup.STORED_ONLY, NOW).outcome();
    }

    private InquiryResolutionContext contextFor(UUID inquiryId) {
        Inquiry q = stored(inquiryId);
        return service.contextFor(org, q, gather(q), OrderFactLookup.STORED_ONLY, NOW);
    }

    /**
     * The one gather this work unit performs — the same call the production draft path makes, stored-only.
     *
     * <p>Resolution reads this; it never repeats it. That is the rule Retrieval Runtime Closure v1 guards, and it
     * is also what keeps this whole path free of model round trips: two of the three retrieval steps are vendor
     * calls when Retrieval v2 is on, and a resolver that re-gathered would pay for them again.
     */
    private InquiryEvidenceRetriever.InquiryEvidence gather(Inquiry q) {
        return retriever.retrieve(org, q, com.sellerops.knowledge.RetrievalQuery.ofCustomer(
                        com.sellerops.common.MarkupText.toPlainText(q.getTitle()),
                        com.sellerops.common.MarkupText.toPlainText(q.getBody())),
                OrderFactLookup.STORED_ONLY, com.sellerops.product.library.KnowledgeVariantScope.unresolved());
    }

    /** Read back out of the database — the point of the exercise is that nothing here is held in memory. */
    private Inquiry stored(UUID inquiryId) {
        return inquiries.findById(inquiryId).orElseThrow();
    }

    private static CustomerGoal goal(String id, RequestedOutcome outcome, Referent subject, String request) {
        String clipped = request.length() > CustomerGoal.MAX_REQUEST
                ? request.substring(0, CustomerGoal.MAX_REQUEST) : request;
        return new CustomerGoal(id, clipped, outcome, subject, RequestBasis.STATED, List.of(), clipped);
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
        row.setChannelId(channelId);
        row.setExternalProductId("EXT-" + UUID.randomUUID());
        row.setSellingStatus(sellingStatus);
        row.setObservedAt(observedAt);
        listings.save(row);
    }

    private void variant(UUID productId, String optionName, String sellingStatus, Instant observedAt) {
        ProductVariant v = new ProductVariant();
        v.setOrgId(org);
        v.setProductId(productId);
        v.setChannelId(channelId);
        v.setExternalVariantId("VAR-" + UUID.randomUUID());
        v.setSource("NAVER:PRODUCT_API:v1");
        v.setOptionName(optionName);
        v.setSellingStatus(sellingStatus);
        v.setObservedAt(observedAt);
        variants.save(v);
    }

    private UUID storeInquiry(UUID productId, String title, String orderRef) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setSellerAccountId(accountId);
        q.setProductId(productId);
        q.setTitle(title);
        q.setBody("문의드립니다.");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-09-20T00:00:00Z"));
        if (orderRef != null) {
            q.setSourceOrderRef(orderRef);
            q.setOrderBinding(InquiryOrderBinding.SOURCE_EXACT.name());
        }
        return inquiries.save(q).getId();
    }

    private void seedOrder(String externalOrderId) {
        ChannelOrder order = new ChannelOrder();
        order.setOrgId(org);
        order.setSellerAccountId(accountId);
        order.setChannelId(channelId);
        order.setExternalOrderId(externalOrderId);
        order.setRawStatusCode("PAYED");
        order.setNormalizedStatus(NormalizedOrderStatus.fromRaw("PAYED"));
        order.setPaymentAmount(10000L);
        order.setSummaryDate(LocalDate.parse("2026-09-19"));
        order.setPaidAt(Instant.parse("2026-09-19T01:00:00Z"));
        order.setFirstSeenAt(Instant.parse("2026-09-19T02:00:00Z"));
        order.setLastSeenAt(Instant.parse("2026-09-20T02:00:00Z"));
        orders.save(order);
    }
}
