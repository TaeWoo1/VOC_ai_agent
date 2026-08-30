package com.sellerops.product.library;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.dto.KnowledgePassage;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Retrieval &amp; Grounding Correctness v1 — the product library through the real scorer.
 *
 * <p>A: the short noun finds the return document. B: the planner's sentence about the same document
 * finds the same document (live 2026-08-29 it found nothing). C: 「배송 기간」 does NOT get that
 * document even though the document mentions 배송비 — lexical overlap is not applicability. F: a
 * question the library has no words for is a miss over an existing library, never absence.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductKnowledgeRetrievalOutcomeTest {

    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductKnowledgeSourceRepository sources;
    @Autowired ProductKnowledgeChunkRepository chunks;
    @Autowired OrganizationRepository organizations;

    private ProductKnowledgeLibraryService library;
    private ProductKnowledgeIndexer indexer;
    private UUID org;
    private UUID productId;

    private static final String RETURN_DOC_TITLE = "교환 및 반품 안내";
    private static final String RETURN_DOC_BODY =
            "반품 조건: 수령 후 7일 이내, 미사용 상태에서만 반품이 가능합니다. 단순 변심 반품 시 반품 배송비 3,000원은 "
                    + "고객 부담입니다. 불량·오배송은 왕복 배송비를 판매자가 부담합니다.";

    @BeforeEach
    void setUp() {
        library = new ProductKnowledgeLibraryService(products, sources, chunks, variants);
        indexer = new ProductKnowledgeIndexer(chunks);
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();
        Product p = new Product();
        p.setOrgId(org);
        // The live product's name: the planner's sentences quote it, and the library discounts it.
        p.setName("QA 전선몰딩");
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        productId = products.save(p).getId();
    }

    @Test
    @DisplayName("A. 「반품 조건」 finds the return document")
    void shortNounFindsTheDocument() {
        source(RETURN_DOC_TITLE, RETURN_DOC_BODY);
        KnowledgeSearchResponse found = search("반품 조건");
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.FOUND);
        assertThat(found.passages()).extracting(KnowledgePassage::title).containsExactly(RETURN_DOC_TITLE);
    }

    @Test
    @DisplayName("B. the planner's sentence about the same document finds the same document")
    void plannerSentenceFindsTheSameDocument() {
        source(RETURN_DOC_TITLE, RETURN_DOC_BODY);
        KnowledgeSearchResponse found = search("이 상품의 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘");
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.FOUND);
        assertThat(found.passages()).extracting(KnowledgePassage::title).containsExactly(RETURN_DOC_TITLE);
        // Found through a shorter form of the question (its SUBJECT), and the response says which.
        assertThat(found.query()).isNotEqualTo("이 상품의 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘");
        assertThat(found.query()).contains("반품");
        assertThat(found.candidatesTried()).isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("C. the three sentences the live planner wrote about the same document find the same document")
    void thePlannersOwnSentencesFindTheSameDocument() {
        source(RETURN_DOC_TITLE, RETURN_DOC_BODY);
        for (String sentence : com.sellerops.knowledge.PlannerSentences.ABOUT_THE_RETURN_DOCUMENT) {
            KnowledgeSearchResponse found = search(sentence);
            assertThat(found.outcome()).as(sentence).isEqualTo(RetrievalOutcome.FOUND);
            assertThat(found.passages()).extracting(KnowledgePassage::title).containsExactly(RETURN_DOC_TITLE);
            assertThat(found.query()).as("matched through a shorter form").isNotEqualTo(sentence).contains("반품");
        }
    }

    @Test
    @DisplayName("capture safety: a source the seller's sentence finds is found by every planner phrasing — same first passage")
    void plannerPhrasingNeverTurnsAFoundSourceIntoAGap() {
        source(RETURN_DOC_TITLE, RETURN_DOC_BODY);
        source("설치 방법", "양면테이프를 떼고 벽면에 눌러 붙입니다. 재부착 시 접착력이 떨어질 수 있습니다.");
        KnowledgeSearchResponse seller = search("QA 전선몰딩 반품 조건이 명시돼 있는지 확인해줘");
        assertThat(seller.outcome()).isEqualTo(RetrievalOutcome.FOUND);
        for (String sentence : com.sellerops.knowledge.PlannerSentences.ABOUT_THE_RETURN_DOCUMENT) {
            KnowledgeSearchResponse planner = search(sentence);
            assertThat(planner.outcome()).as(sentence).isEqualTo(seller.outcome());
            assertThat(planner.passages().get(0).title()).as(sentence).isEqualTo(seller.passages().get(0).title());
        }
    }

    @Test
    @DisplayName("a structured topic the caller already holds is tried first and reported as the matching form")
    void structuredTopicIsTriedFirst() {
        source(RETURN_DOC_TITLE, RETURN_DOC_BODY);
        KnowledgeSearchResponse found = library.search(org, productId,
                RetrievalQuery.of("교환 반품 환불", null, com.sellerops.knowledge.PlannerSentences.ABOUT_THE_RETURN_DOCUMENT[1]),
                5, KnowledgeVariantScope.unresolved());
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.FOUND);
        assertThat(found.candidatesTried()).isEqualTo(1);
        assertThat(found.query()).isEqualTo("교환 반품 환불");
    }

    @Test
    @DisplayName("D. the planner's phrasing of a shipping question still does not adopt the return document")
    void plannerShippingPhrasingStaysNotApplicable() {
        source(RETURN_DOC_TITLE, RETURN_DOC_BODY);
        KnowledgeSearchResponse found = search("‘QA 전선몰딩’의 상품 설명/FAQ 문서 중 배송 기간이 명시된 문장이 있는가");
        assertThat(found.passages()).isEmpty();
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.NOT_APPLICABLE);
    }

    @Test
    @DisplayName("C. 「배송 기간」 does not adopt the return document on keyword overlap — NOT_APPLICABLE")
    void shippingQuestionDoesNotAdoptTheReturnDocument() {
        source(RETURN_DOC_TITLE, RETURN_DOC_BODY);
        KnowledgeSearchResponse found = search("배송 기간");
        assertThat(found.passages()).isEmpty();
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.NOT_APPLICABLE);
        assertThat(found.rejectedNotApplicable()).isGreaterThan(0);
    }

    @Test
    @DisplayName("F. a library that has no words for the question is NO_RELEVANT_EVIDENCE, never ABSENT")
    void missOverAnExistingLibraryIsNotAbsence() {
        source(RETURN_DOC_TITLE, RETURN_DOC_BODY);
        KnowledgeSearchResponse found = search("방수 되나요?");
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.NO_RELEVANT_EVIDENCE);
        assertThat(found.documentsSearched()).isEqualTo(1);
    }

    @Test
    @DisplayName("an empty library is ABSENT, whatever is asked")
    void emptyLibraryIsAbsent() {
        assertThat(search("반품 조건").outcome()).isEqualTo(RetrievalOutcome.ABSENT);
    }

    @Test
    @DisplayName("a topic-free document (FAQ title) is never rejected on topic")
    void undeclaredDocumentIsNotRejected() {
        source("자주 묻는 질문", "배송은 보통 영업일 기준 2~3일 걸립니다.");
        KnowledgeSearchResponse found = search("배송 기간");
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.FOUND);
    }

    private KnowledgeSearchResponse search(String question) {
        return library.search(org, productId, RetrievalQuery.ofText(question), 5, KnowledgeVariantScope.unresolved());
    }

    private void source(String title, String body) {
        ProductKnowledgeSource s = new ProductKnowledgeSource();
        s.setOrgId(org);
        s.setProductId(productId);
        s.setSourceType(KnowledgeSourceType.POLICY);
        s.setTitle(title);
        s.setBody(body);
        s.setAuthoredOrigin(KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);
        indexer.index(sources.save(s));
    }
}
