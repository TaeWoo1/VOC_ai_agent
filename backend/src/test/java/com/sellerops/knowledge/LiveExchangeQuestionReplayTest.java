package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryProductBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.inquiry.goal.CustomerGoal;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.Referent;
import com.sellerops.inquiry.goal.RequestBasis;
import com.sellerops.inquiry.goal.RequestedOutcome;
import com.sellerops.inquiry.resolve.InquiryGoalResolutionService;
import com.sellerops.inquiry.resolve.InquiryResolutionContext;
import com.sellerops.inquiry.resolve.InquiryResolutionView;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.operationscase.CaseFromResolution;
import com.sellerops.operationscase.RecommendedActionType;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.order.fact.StoredOnlyOrderFacts;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.inquiry.resolve.CustomerGoalInterpretation;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Optional;
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
 * <b>The live Cafe24 row that said 「등록된 지식에 이 질문을 결정하는 내용이 없어」 about a policy the seller
 * had already written down.</b>
 *
 * <p>2026-09-21, demo org: 「교환 신청은 언제까지 가능한가요?」 resolved {@code NEEDS_SELLER}
 * ({@code consulted: [KNOWLEDGE.ORG]}, {@code observed: []}) while that organisation held an active
 * {@code EXCHANGE_REFUND_POLICY} reading 「수령 후 7일 이내, 개봉하지 않은 상품에 한해 교환과 반품이
 * 가능합니다.」 — a document that plainly answers it.
 *
 * <h2>Nothing was wrong with the ranking</h2>
 *
 * <p>Measured before the fix: the right passage's coverage was <b>1.000</b>. What refused was the
 * ABSENCE gate — {@code askableRatio} 2/14 = 0.14 against a 0.35 floor — because two of the question's
 * four content words were grammar that had been counted as topic: 「언제까지」 (an interrogative this
 * file already drops, wearing a particle this file already knows) and 「가능한가요」 (the ㄴ가요
 * interrogative, whose 하-verb stem could not reach the same verb's 가능<b>합니다</b>).
 *
 * <p>So the corpus was judged silent about a question it answers, and the seller was asked to supply
 * knowledge they had supplied. This replays the row — the real question, the real two documents, the
 * real goal — through the production retriever, assessor and resolvers, offline: no model, no
 * marketplace, no live database.
 *
 * <p>The fixture is the two documents the org actually holds, <b>including the English shipping
 * note</b>, because the second half of the claim is that the fix does not simply admit more: that
 * note also mentions exchanges and it must still lose.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class LiveExchangeQuestionReplayTest {

    /** The customer's post, as Cafe24 stored it — meta literal and all (`MarkupText` strips before decoding). */
    private static final String TITLE = "교환 신청은 언제까지 가능한가요?";
    private static final String RAW_BODY =
            "<p>&lt;meta charset=&quot;utf-8&quot;&gt;교환 신청은 언제까지 가능한가요?</p>";

    private static final String POLICY_TITLE = "교환·반품 기준";
    private static final String POLICY_BODY = "수령 후 7일 이내, 개봉하지 않은 상품에 한해 교환과 반품이 가능합니다.";
    private static final String SHIPPING_TITLE = "배송교환정책";
    private static final String SHIPPING_BODY =
            "Shipping and exchange policy\nOrders paid before 2 PM on a business day are dispatched the same day.\n"
                    + "Weekend and public holiday orders are dispatched on the next business day.\n"
                    + "Exchanges are accepted within 7 days of delivery when the product is unused.";

    @Autowired OrganizationRepository organizations;
    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ChannelProductRepository listings;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired InquiryRepository inquiries;
    @Autowired ChannelRepository channels;
    @Autowired ChannelOrderRepository orders;

    private UUID org;
    private Inquiry inquiry;
    private InquiryKnowledgeAssessor assessor;
    private InquiryGoalResolutionService resolution;

    @BeforeEach
    void setUp() {
        Organization o = new Organization();
        o.setName("live replay");
        org = organizations.save(o).getId();
        Product p = new Product();
        p.setOrgId(org);
        p.setName("선바로 일체형 전선몰딩");
        p.setStatus("ACTIVE");
        UUID productId = products.save(p).getId();

        SellerOperationsKnowledgeService policies = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        policies.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.SHIPPING_POLICY, SHIPPING_TITLE,
                SHIPPING_BODY, null), UUID.randomUUID(), "운영자");
        policies.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, POLICY_TITLE,
                POLICY_BODY, null), UUID.randomUUID(), "운영자");

        InquiryEvidenceRetriever retriever = new InquiryEvidenceRetriever(products,
                new ProductKnowledgeLibraryService(products, productSources, productChunks, variants), policies,
                new AnswerMemoryService(memories, orgChunks, productChunks),
                StoredOnlyOrderFacts.reader(orders, channels,
                        (a, b, c, d) -> com.sellerops.coverage.ChannelDataState.OBSERVED_FRESH));
        assessor = InquiryKnowledgeAssessor.withoutContext(retriever, variants);
        resolution = new InquiryGoalResolutionService(new CapabilityRegistry(channels, listings, variants));

        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setTitle(TITLE);
        q.setBody(MarkupText.toPlainText(RAW_BODY));
        q.setStatus("UNANSWERED");
        q.setProductId(productId);
        q.setProductBinding(InquiryProductBinding.SOURCE_EXACT.name());
        q.setReceivedAt(Instant.parse("2026-09-21T13:10:20Z"));
        inquiry = inquiries.save(q);
    }

    @Test
    @DisplayName("the live question reaches the seller's own exchange policy — and only that one")
    void theQuestionFindsTheRuleTheSellerAlreadyWroteDown() {
        InquiryKnowledgeAssessor.Assessment assessed = assessor.assess(org, inquiry, OrderFactLookup.STORED_ONLY);

        assertThat(assessed.retrieved().policyOutcome())
                .as("the org lane was asked the same question and now has an answer for it")
                .isEqualTo(RetrievalOutcome.FOUND);
        assertThat(assessed.basis().name()).isEqualTo("GROUNDED");
        assertThat(assessed.gap().askedSubject())
                .as("the assessment still describes what each lane reached, but it names nothing as missing — "
                        + "so the case has no subject to ask the seller about")
                .isNull();
        assertThat(assessed.gap().missingSubject()).isNull();
        assertThat(assessed.gap().policyOutcome()).isEqualTo(RetrievalOutcome.FOUND.name());

        assertThat(assessed.retrieved().passages()).isNotEmpty();
        assertThat(assessed.retrieved().passages())
                .as("the English shipping note also says 'exchanges are accepted within 7 days' — the fix must "
                        + "not simply admit more, so that note still loses to the rule that is about 교환")
                .allSatisfy(passage -> assertThat(passage.text()).contains("7일 이내"));
    }

    /**
     * The live Cafe24 post of the stage-2 run: a courtesy title, the editor's escaped {@code <meta>} literal, and
     * two questions in the body. It reaches the same policy — and when a question this library cannot answer
     * arrives in the same shape, what the seller is asked for is a noun from the question, never the title's verb.
     */
    private Inquiry saved(String title, String rawBody) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setTitle(title);
        q.setBody(MarkupText.toPlainText(rawBody));
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-09-23T01:08:00Z"));
        return inquiries.save(q);
    }

    private void readingGoals(String... requests) {
        List<CustomerGoal> goals = new ArrayList<>();
        for (int i = 0; i < requests.length; i++) {
            goals.add(new CustomerGoal("g" + (i + 1), requests[i], RequestedOutcome.ANSWER, Referent.ORGANIZATION,
                    RequestBasis.STATED, List.of(), requests[i]));
        }
        CustomerGoalSet set = new CustomerGoalSet(goals, List.of());
        assessor.setGoals(new CustomerGoalInterpretation() {
            @Override
            public Optional<CustomerGoalSet> interpret(UUID orgId, Inquiry inquiry) {
                return Optional.of(set);
            }

            @Override
            public Optional<CustomerGoalSet> stored(UUID orgId, Inquiry inquiry) {
                return Optional.of(set);
            }
        });
    }

    @Test
    @DisplayName("the stage-2 post — courtesy title, two questions — still reaches the same policy")
    void theStageTwoPostFindsTheSamePolicy() {
        readingGoals("교환이나 반품은 언제까지 가능한가요?", "개봉하지 않은 상품 기준도 함께 알려주세요.");
        Inquiry post = saved("문의 드립니다",
                "<p>&lt;meta charset=&quot;utf-8&quot;&gt;상품을 받은 뒤 교환이나 반품은 언제까지 가능한가요? "
                        + "개봉하지 않은 상품 기준도 함께 알려주세요.</p>");

        InquiryKnowledgeAssessor.Assessment assessed = assessor.assess(org, post, OrderFactLookup.STORED_ONLY);

        assertThat(assessed.retrieved().policyOutcome()).isEqualTo(RetrievalOutcome.FOUND);
        assertThat(assessed.basis().name()).isEqualTo("GROUNDED");
        assertThat(assessed.missingSubject()).isNull();
    }

    @Test
    @DisplayName("a question this library cannot answer is missing a NOUN from the question, not the title's verb")
    void theGapNamesANounTheCustomerAskedAbout() {
        readingGoals("해외 배송도 가능한가요?", "관부가세는 누가 부담하나요?");
        Inquiry post = saved("문의 드립니다",
                "<p>&lt;meta charset=&quot;utf-8&quot;&gt;해외 배송도 가능한가요? 관부가세는 누가 부담하나요?</p>");

        InquiryKnowledgeAssessor.Assessment assessed = assessor.assess(org, post, OrderFactLookup.STORED_ONLY);

        assertThat(assessed.basis().name())
                .as("no shipping rule of this org speaks to 해외 배송 or 관부가세")
                .isEqualTo("NO_ANSWER_BASIS");
        assertThat(assessed.missingSubject())
                .as("the live defect quoted 드립니다 — the post's greeting — back at the seller")
                .isEqualTo("해외");
    }

    @Test
    @DisplayName("...so the goal resolves, and the case recommends a reply instead of asking for knowledge")
    void theResolutionSettlesAsAReply() {
        InquiryKnowledgeAssessor.Assessment assessed = assessor.assess(org, inquiry, OrderFactLookup.STORED_ONLY);
        InquiryResolutionContext context = resolution.contextFor(org, inquiry, assessed.retrieved(),
                OrderFactLookup.STORED_ONLY, Instant.parse("2026-09-21T13:29:00Z"));
        CustomerGoalSet goals = new CustomerGoalSet(List.of(new CustomerGoal("g1", TITLE,
                RequestedOutcome.ANSWER, Referent.ORGANIZATION, RequestBasis.STATED, List.of(), TITLE)), List.of());

        InquiryResolutionView view = InquiryResolutionView.of(InquiryGoalResolutionService.resolve(goals, context));

        assertThat(view.resolved()).singleElement()
                .satisfies(goal -> assertThat(goal.state()).isEqualTo("RESOLVED"));

        CaseFromResolution reading = CaseFromResolution.of(view);
        assertThat(reading).isNotNull();
        assertThat(reading.recommendedAction()).isEqualTo(RecommendedActionType.REPLY_TO_CUSTOMER);
        assertThat(reading.summaryKo()).isEqualTo("등록된 지식으로 답변할 수 있는 문의입니다.");
    }
}
