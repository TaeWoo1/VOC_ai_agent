package com.sellerops.knowledge.memory;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.common.DataOrigin;
import com.sellerops.knowledge.memory.dto.AnswerMemorySearchResponse;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Answer Memory: what the seller has actually said, and what may never be mistaken for it.
 *
 * <p>Two properties carry the safety of this class and both are tested as negatives. Strength never
 * falls, so a channel re-collection cannot demote an answer this org verified. And two remembered
 * answers that state the same standing rule differently do not both reach a drafter — the seller's
 * strongest, most recent statement is what the company currently does, and offering the pair would
 * be handing the model a contradiction and letting it pick.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class AnswerMemoryServiceTest {

    @Autowired AnswerMemoryRepository memories;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrganizationRepository organizations;
    @Autowired ProductRepository products;

    private AnswerMemoryService service;
    private UUID org;

    @BeforeEach
    void setUp() {
        service = new AnswerMemoryService(memories, orgChunks, productChunks);
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();
        // The seller's own vocabulary, which is what the topic signature is allowed to draw on.
        new SellerOperationsKnowledgeService(orgSources, orgChunks).create(org,
                new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환 및 반품 안내",
                        "수령 후 7일 이내에 교환을 신청하실 수 있습니다.", null),
                UUID.randomUUID(), "데모 운영자");
    }

    @Test
    @DisplayName("a remembered answer is found by the topic it answered")
    void aRememberedAnswerIsFindable() {
        remember("inquiry-answer:1", AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                "교환 신청 어떻게 하나요", "교환은 수령 후 7일 이내에 신청해 주시면 도와드리겠습니다.",
                "exchange_return_reply", null);

        AnswerMemorySearchResponse found = service.search(org, "교환 신청 기간이 어떻게 되나요?", null, 3);

        assertThat(found.passages()).singleElement().satisfies(p -> {
            assertThat(p.strength()).isEqualTo(AnswerMemoryStrength.IMPORTED_SELLER_ANSWER);
            assertThat(p.strengthLabel()).isEqualTo("채널에 등록된 답변");
        });
    }

    @Test
    @DisplayName("strength never falls: a re-collection cannot demote an answer this org verified")
    void strengthNeverFalls() {
        remember("verified:1", AnswerMemoryStrength.EXECUTOR_SENT_VERIFIED,
                "교환 신청", "교환은 7일 이내에 신청해 주세요.", "exchange_return_reply", null);
        remember("verified:1", AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                "교환 신청", "교환은 7일 이내에 신청해 주세요.", "exchange_return_reply", null);

        assertThat(memories.findByOrgIdAndOriginRef(org, "verified:1")).get()
                .extracting(AnswerMemory::getStrength)
                .isEqualTo(AnswerMemoryStrength.EXECUTOR_SENT_VERIFIED);
    }

    @Test
    @DisplayName("re-recording the same act is idempotent; changing the text is a new revision")
    void reRecordingIsIdempotentAndRevisionsAreCounted() {
        remember("approved:1:2", AnswerMemoryStrength.USER_APPROVED,
                "교환 신청", "교환은 7일 이내에 신청해 주세요.", "exchange_return_reply", null);
        remember("approved:1:2", AnswerMemoryStrength.USER_APPROVED,
                "교환 신청", "교환은 7일 이내에 신청해 주세요.", "exchange_return_reply", null);
        assertThat(memories.countByOrgId(org)).isOne();
        assertThat(memories.findByOrgIdAndOriginRef(org, "approved:1:2")).get()
                .extracting(AnswerMemory::getVersion).isEqualTo(1);

        remember("approved:1:2", AnswerMemoryStrength.USER_APPROVED,
                "교환 신청", "교환 여부는 제품 확인 후 안내드립니다.", "exchange_return_reply", null);
        assertThat(memories.findByOrgIdAndOriginRef(org, "approved:1:2")).get()
                .extracting(AnswerMemory::getVersion).isEqualTo(2);
    }

    @Test
    @DisplayName("two answers to one standing rule do not both reach the drafter — the stronger wins")
    void conflictingMemoriesCollapseToTheStrongest() {
        remember("inquiry-answer:old", AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                "교환 되나요", "네, 교환 가능합니다.", "exchange_return_reply", null);
        remember("approved:new:1", AnswerMemoryStrength.USER_APPROVED,
                "교환 되나요", "교환 여부는 제품 확인 후 안내드립니다.", "exchange_return_reply", null);

        AnswerMemorySearchResponse found = service.search(org, "교환 되나요?", null, 3);

        assertThat(found.passages()).singleElement()
                .satisfies(p -> assertThat(p.strength()).isEqualTo(AnswerMemoryStrength.USER_APPROVED));
        assertThat(found.supersededByConflict())
                .as("the older answer is suppressed, and the seller is told it exists").isOne();
    }

    @Test
    @DisplayName("an answer bound to another product is never offered for this one")
    void anotherProductsAnswerIsNeverOffered() {
        UUID mine = product("선바로 일체형 전선몰딩");
        UUID theirs = product("다른 상품");
        remember("inquiry-answer:other", AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                "교환 신청", "교환은 7일 이내에 신청해 주세요.", "exchange_return_reply", theirs);

        assertThat(service.search(org, "교환 신청 기간", mine, 3).passages()).isEmpty();
        assertThat(service.search(org, "교환 신청 기간", theirs, 3).passages()).isNotEmpty();
    }

    @Test
    @DisplayName("an unbound answer is offered for any question — it never named a product to be wrong about")
    void anUnboundAnswerIsOfferedAnywhere() {
        remember("inquiry-answer:free", AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                "교환 신청", "교환은 7일 이내에 신청해 주세요.", "exchange_return_reply", null);

        assertThat(service.search(org, "교환 신청 기간", product("아무 상품"), 3).passages()).isNotEmpty();
    }

    @Test
    @DisplayName("an answer is not evidence for itself — the inquiry it came from is excluded")
    void anAnswerIsNotEvidenceForItsOwnInquiry() {
        UUID inquiryId = UUID.randomUUID();
        service.remember(new AnswerMemoryService.RememberCommand(
                org, "approved:self:1", AnswerMemoryStrength.USER_APPROVED, "교환 신청 기간", null,
                "교환은 수령 후 7일 이내에 신청해 주세요.", null, "NAVER", null,
                "exchange_return_reply", inquiryId, null, null, null, null, DataOrigin.REAL));

        assertThat(service.search(org, "교환 신청 기간", null, inquiryId, 3).passages())
                .as("regenerating a draft must not read its own approved answer back as precedent")
                .isEmpty();
        assertThat(service.search(org, "교환 신청 기간", null, UUID.randomUUID(), 3).passages())
                .as("the same sentence approved on a DIFFERENT inquiry genuinely is precedent")
                .isNotEmpty();
    }

    @Test
    @DisplayName("a blank answer is not a memory")
    void blankAnswersAreNotRemembered() {
        assertThat(service.remember(new AnswerMemoryService.RememberCommand(
                org, "approved:blank:1", AnswerMemoryStrength.USER_APPROVED, "질문", null, "   ",
                null, null, null, null, null, null, null, null, null, DataOrigin.REAL))).isEmpty();
        assertThat(memories.countByOrgId(org)).isZero();
    }

    @Test
    @DisplayName("the customer's question is never stored — only the words the seller also uses")
    void theQuestionIsNotStored() {
        remember("inquiry-answer:pii", AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                "홍길동입니다 서울시 강남구 010-1234-5678 교환 문의",
                "교환은 7일 이내에 신청해 주세요.", "exchange_return_reply", null);

        AnswerMemory row = memories.findByOrgIdAndOriginRef(org, "inquiry-answer:pii").orElseThrow();
        assertThat(row.getTopicSignature())
                .doesNotContain("홍길동").doesNotContain("강남").doesNotContain("1234")
                .contains("교환");
    }

    private void remember(String originRef, AnswerMemoryStrength strength, String question,
                          String answer, String category, UUID productId) {
        service.remember(new AnswerMemoryService.RememberCommand(
                org, originRef, strength, question, null, answer, productId, "NAVER", null,
                category, null, null, null, null, null, DataOrigin.REAL));
    }

    private UUID product(String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }
}
