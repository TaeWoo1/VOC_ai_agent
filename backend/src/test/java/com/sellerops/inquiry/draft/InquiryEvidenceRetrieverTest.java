package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.memory.AnswerMemoryStrength;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
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
 * The retrieval hierarchy: three lanes, one scorer, and no lane that wins by being a lane.
 *
 * <p>The two failures this guards are opposite. A pure top-N by score answers "이 상품 반품하려면?"
 * with whichever lane happens to be wordier, so a mixed question loses half its evidence. And a
 * per-scope priority answers "폭이 몇 mm인가요?" out of a shipping policy whenever the product library
 * is thin, which is the 2026-08-24 inversion wearing a different hat.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryEvidenceRetrieverTest {

    @Autowired ProductRepository products;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired ChannelOrderRepository channelOrders;
    @Autowired OrganizationRepository organizations;

    private InquiryEvidenceRetriever retriever;
    private ProductKnowledgeLibraryService productKnowledge;
    private SellerOperationsKnowledgeService orgKnowledge;
    private AnswerMemoryService answerMemory;
    private UUID org;

    @BeforeEach
    void setUp() {
        productKnowledge = new ProductKnowledgeLibraryService(products, productSources, productChunks);
        orgKnowledge = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        answerMemory = new AnswerMemoryService(memories, orgChunks, productChunks);
        retriever = new InquiryEvidenceRetriever(products, productKnowledge, orgKnowledge, answerMemory,
                new InquiryOrderContextReader(channelOrders));
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();
    }

    @Test
    @DisplayName("an inquiry with no product is still grounded — in the company's operating policy")
    void aProductlessInquiryIsGroundedInPolicy() {
        policy(OrgKnowledgeType.CASH_RECEIPT, "현금영수증 발급 안내",
                "결제 완료 후 현금영수증 발급을 요청하실 수 있습니다. 주문 시 입력하신 휴대폰 번호로 발급됩니다.");

        InquiryEvidenceRetriever.InquiryEvidence found =
                retriever.retrieve(org, inquiry(null, "현금영수증 발급 가능한가요?"));

        assertThat(found.productId()).isNull();
        assertThat(found.state()).as("no product no longer means no grounding")
                .isEqualTo(DraftKnowledgeState.GROUNDED);
        assertThat(found.scopes()).containsExactly(KnowledgeScope.ORG_OPERATIONS);
    }

    @Test
    @DisplayName("a spec question is not answered out of a policy, however empty the product library is")
    void aSpecQuestionIsNotAnsweredFromPolicy() {
        UUID productId = product("선바로 일체형 전선몰딩");
        policy(OrgKnowledgeType.SHIPPING_POLICY, "배송 안내",
                "영업일 기준 2일 이내 출고되며, 배송비는 3000원입니다. 도서산간은 추가 비용이 발생합니다.");

        InquiryEvidenceRetriever.InquiryEvidence found =
                retriever.retrieve(org, inquiry(productId, "내부 폭이 몇 mm인가요?"));

        assertThat(found.passages()).isEmpty();
        assertThat(found.state()).as("the product has no library and the policy does not cover a width")
                .isEqualTo(DraftKnowledgeState.NO_LIBRARY);
    }

    @Test
    @DisplayName("a mixed question keeps one passage from each lane that can speak to it")
    void aMixedQuestionKeepsBothLanes() {
        UUID productId = product("선바로 일체형 전선몰딩");
        // A deliberately wordy policy, so a pure top-N by score would crowd the product lane out.
        policy(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환 및 반품 안내",
                "교환은 수령 후 7일 이내에 신청하실 수 있습니다.\n\n"
                        + "단순 변심의 경우 왕복 배송비가 부과됩니다.\n\n"
                        + "제품 하자인 경우 교환 배송비는 부과되지 않습니다.\n\n"
                        + "사용하신 제품은 교환이 어려울 수 있습니다.");
        productKnowledge.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.USAGE,
                "몰딩 교환 시 주의사항", "몰딩은 재부착 시 접착력이 약해지므로 교환 전 벽면 상태를 확인해 주세요.",
                null), UUID.randomUUID(), "데모 운영자");

        InquiryEvidenceRetriever.InquiryEvidence found =
                retriever.retrieve(org, inquiry(productId, "재부착 후 교환 신청 기간이 어떻게 되나요?", ""));

        assertThat(found.scopes())
                .as("the product's own caveat and the company's rule are both part of the answer")
                .contains(KnowledgeScope.PRODUCT, KnowledgeScope.ORG_OPERATIONS);
        assertThat(found.passages()).hasSizeLessThanOrEqualTo(InquiryEvidenceRetriever.MAX_PASSAGES);
    }

    @Test
    @DisplayName("a past answer is offered as its own scope, never as product knowledge")
    void aPastAnswerIsItsOwnScope() {
        policy(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환 및 반품 안내",
                "교환은 수령 후 7일 이내에 신청하실 수 있습니다.");
        answerMemory.remember(new AnswerMemoryService.RememberCommand(
                org, "inquiry-answer:1", AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                "교환 신청 기간", null, "교환은 수령 후 7일 이내에 신청해 주시면 도와드리겠습니다.",
                null, "NAVER", null, "exchange_return_reply", null, null, null, null, null,
                DataOrigin.REAL));

        InquiryEvidenceRetriever.InquiryEvidence found =
                retriever.retrieve(org, inquiry(null, "교환 신청 기간이 어떻게 되나요?"));

        assertThat(found.scopes()).contains(KnowledgeScope.PAST_ANSWER);
        assertThat(found.passages())
                .filteredOn(p -> p.scope() == KnowledgeScope.PAST_ANSWER)
                .allSatisfy(p -> assertThat(p.locator()).startsWith("answer-memory/"));
    }

    @Test
    @DisplayName("order state is never retrieved — it is read, and today it reports why it cannot be")
    void orderStateIsReadAndUnavailable() {
        InquiryEvidenceRetriever.InquiryEvidence found =
                retriever.retrieve(org, inquiry(null, "제 주문 언제 발송되나요?"));

        assertThat(found.order().available()).isFalse();
        assertThat(found.order().reasonCode())
                .isEqualTo(InquiryOrderContextReader.CHANNEL_ORDERS_NOT_COLLECTED);
        assertThat(found.scopes()).doesNotContain(KnowledgeScope.ORDER_STATE);
    }

    @Test
    @DisplayName("the same question and corpus return the same evidence in the same order")
    void retrievalIsReproducible() {
        policy(OrgKnowledgeType.CASH_RECEIPT, "현금영수증 발급 안내",
                "결제 완료 후 현금영수증 발급을 요청하실 수 있습니다.");
        policy(OrgKnowledgeType.TAX_INVOICE, "세금계산서 발행 안내",
                "사업자 등록증을 보내주시면 세금계산서를 발행해 드립니다.");
        Inquiry q = inquiry(null, "현금영수증 발급 가능한가요?");

        assertThat(retriever.retrieve(org, q).passages())
                .isEqualTo(retriever.retrieve(org, q).passages());
    }

    private void policy(OrgKnowledgeType type, String title, String body) {
        orgKnowledge.create(org, new OrgKnowledgeRequest(type, title, body, null),
                UUID.randomUUID(), "데모 운영자");
    }

    private UUID product(String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }

    private Inquiry inquiry(UUID productId, String title) {
        return inquiry(productId, title, "문의드립니다.");
    }

    private Inquiry inquiry(UUID productId, String title, String body) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setSellerAccountId(UUID.randomUUID());
        q.setProductId(productId);
        q.setTitle(title);
        q.setBody(body);
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-08-24T00:00:00Z"));
        return q;
    }
}
