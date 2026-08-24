package com.sellerops.inquiry.coverage;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeNeed;
import com.sellerops.inquiry.draft.InquiryOrderFactReader;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.fact.OrderStoreFreshness;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The coverage audit — the number that says whether this architecture reaches a real backlog.
 *
 * <p>What is asserted here is that the measurement MOVES for the right reason. A backlog of policy
 * questions must read as UNSUPPORTED while nobody has written the policy, and as GROUNDED the moment
 * someone does — with no other change. A number that cannot move on a written document is measuring
 * the retrieval's mood rather than the library's contents.
 *
 * <p>And the output is counts. The corpus this walks is real customer mail, so a per-row report would
 * be the same data leak as printing the backlog.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryKnowledgeCoverageServiceTest {


    /**
     * The freshness verdict, supplied directly.
     *
     * <p>These tests are about which order a reference resolves to and what may be said about it —
     * not about whether the capability registry declares ORDER_SUMMARY. {@code OBSERVED_FRESH} keeps
     * that axis out of the way, so a failure here means the binding is wrong.
     */
    private static final OrderStoreFreshness FRESH =
            (orgId, channelCode, accountId, rows) -> ChannelDataState.OBSERVED_FRESH;

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired ChannelRepository channels;
    @Autowired ProductRepository products;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired ChannelOrderRepository channelOrders;
    @Autowired OrganizationRepository organizations;

    private InquiryKnowledgeCoverageService coverage;
    private SellerOperationsKnowledgeService orgKnowledge;
    private UUID org;
    private String channelCode;

    @BeforeEach
    void setUp() {
        orgKnowledge = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        coverage = new InquiryKnowledgeCoverageService(inquiries, channels,
                new InquiryEvidenceRetriever(products,
                        new ProductKnowledgeLibraryService(products, productSources, productChunks),
                        orgKnowledge, new AnswerMemoryService(memories, orgChunks, productChunks),
                        new InquiryOrderFactReader(channelOrders, channels, FRESH)),
                orgSources, memories, workItems, channelOrders);
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();
        channelCode = "TESTCH-" + UUID.randomUUID().toString().substring(0, 8);
        Channel c = new Channel();
        c.setCode(channelCode);
        c.setNameKo("테스트 채널");
        c.setStatus(com.sellerops.channel.ChannelStatus.CONNECTED);
        channels.save(c);
    }

    @Test
    @DisplayName("an unanswered policy backlog reads as UNSUPPORTED while nobody has written the policy")
    void anEmptyLibraryLeavesTheBacklogUnsupported() {
        seed("현금영수증 발급 가능한가요?");
        seed("세금계산서 발행 부탁드립니다");

        InquiryKnowledgeCoverageService.CoverageReport before = coverage.measure(org, channelCode);

        assertThat(before.inquiries()).isEqualTo(2);
        assertThat(before.byNeed()).containsEntry(InquiryKnowledgeNeed.ORG_POLICY_NEEDED, 2);
        assertThat(before.byOutcome())
                .containsEntry(InquiryKnowledgeCoverageService.CoverageOutcome.UNSUPPORTED, 2)
                .containsEntry(InquiryKnowledgeCoverageService.CoverageOutcome.GROUNDED, 0);
        assertThat(before.missingPolicy()).isEqualTo(2);
        assertThat(before.orgKnowledgeDocuments()).isZero();
    }

    @Test
    @DisplayName("writing the policy — and nothing else — moves the number")
    void writingThePolicyMovesTheNumber() {
        seed("현금영수증 발급 가능한가요?");
        seed("세금계산서 발행 부탁드립니다");
        assertThat(coverage.measure(org, channelCode).byOutcome())
                .containsEntry(InquiryKnowledgeCoverageService.CoverageOutcome.GROUNDED, 0);

        orgKnowledge.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.CASH_RECEIPT,
                "현금영수증 발급 안내",
                "결제 완료 후 현금영수증 발급을 요청하실 수 있습니다. 주문 시 입력하신 번호로 발급됩니다.",
                null), UUID.randomUUID(), "데모 운영자");

        InquiryKnowledgeCoverageService.CoverageReport after = coverage.measure(org, channelCode);

        assertThat(after.byOutcome())
                .as("one document, one question closed — and the tax question is still open")
                .containsEntry(InquiryKnowledgeCoverageService.CoverageOutcome.GROUNDED, 1)
                .containsEntry(InquiryKnowledgeCoverageService.CoverageOutcome.UNSUPPORTED, 1);
        assertThat(after.missingPolicy()).isOne();
        assertThat(after.orgKnowledgeDocuments()).isOne();
    }

    @Test
    @DisplayName("an order question is never counted as grounded — no policy substitutes for the order")
    void anOrderQuestionIsNeverGrounded() {
        seed("주문한 상품 언제 발송되나요");
        orgKnowledge.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.SHIPPING_POLICY, "배송 안내",
                "영업일 기준 2일 이내 출고되며, 택배사 사정에 따라 하루 정도 늦어질 수 있습니다.", null),
                UUID.randomUUID(), "데모 운영자");

        InquiryKnowledgeCoverageService.CoverageReport report = coverage.measure(org, channelCode);

        assertThat(report.byNeed()).containsEntry(InquiryKnowledgeNeed.ORDER_CONTEXT_NEEDED, 1);
        assertThat(report.missingOrder()).isOne();
        assertThat(report.byOutcome())
                .as("a shipping policy is not a shipping date")
                .containsEntry(InquiryKnowledgeCoverageService.CoverageOutcome.GROUNDED, 0);
    }

    @Test
    @DisplayName("what the seller dismissed as spam is not part of the backlog being measured")
    void dismissedInquiriesAreNotMeasured() {
        Inquiry spam = seed("현금영수증 발급 가능한가요?");
        spam.setOperationalState(InquiryOperationalState.EXCLUDED_SPAM);
        inquiries.save(spam);

        assertThat(coverage.measure(org, channelCode).inquiries()).isZero();
    }

    private Inquiry seed(String title) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channels.findByCode(channelCode).orElseThrow().getId());
        q.setSellerAccountId(UUID.randomUUID());
        q.setTitle(title);
        q.setBody("문의드립니다.");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-08-24T00:00:00Z"));
        return inquiries.save(q);
    }
}
