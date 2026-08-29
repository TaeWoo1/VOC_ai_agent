package com.sellerops.product.library;

import static org.assertj.core.api.Assertions.assertThat;

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
 * Knowledge Context v1-A: provenance is a tie-break, never a weight.
 *
 * <p>Relevance and applicability decide first. Only when two passages cover the question equally does
 * what the seller typed outrank what a channel page said, which outranks what a model read off an
 * image — and a less relevant seller passage never climbs over a more relevant channel passage.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class KnowledgeProvenanceTieBreakTest {

    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductKnowledgeSourceRepository sources;
    @Autowired ProductKnowledgeChunkRepository chunks;
    @Autowired OrganizationRepository organizations;

    private ProductKnowledgeLibraryService library;
    private ProductKnowledgeIndexer indexer;
    private UUID org;
    private UUID productId;

    @BeforeEach
    void setUp() {
        library = new ProductKnowledgeLibraryService(products, sources, chunks, variants);
        indexer = new ProductKnowledgeIndexer(chunks);
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();
        Product p = new Product();
        p.setOrgId(org);
        p.setName("전선몰딩");
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        productId = products.save(p).getId();
    }

    @Test
    @DisplayName("equal relevance: seller-typed before channel page before image extraction")
    void equalRelevanceBreaksTowardTheSeller() {
        String body = "교환은 수령 후 7일 이내에 신청하실 수 있습니다.";
        // Saved in the OPPOSITE order of the expected result, so creation order cannot be what sorts them.
        source("교환 안내", body, KnowledgeAuthorship.AI_EXTRACTED_FROM_SELLER_IMAGE);
        source("교환 안내", body, KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT);
        source("교환 안내", body, KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);

        KnowledgeSearchResponse found = library.search(org, productId, "교환 신청 기간이 어떻게 되나요?", 5,
                KnowledgeVariantScope.unresolved());

        assertThat(found.passages()).hasSize(3);
        assertThat(found.passages().stream().map(KnowledgePassage::score).distinct())
                .as("the three passages really are tied on relevance").hasSize(1);
        assertThat(found.passages().stream().map(KnowledgePassage::authoredOrigin))
                .containsExactly(KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE,
                        KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT,
                        KnowledgeAuthorship.AI_EXTRACTED_FROM_SELLER_IMAGE);
    }

    @Test
    @DisplayName("relevance first: a more relevant image passage still outranks a less relevant seller passage")
    void relevanceIsNotOverturnedByProvenance() {
        source("교환 안내", "교환은 수령 후 7일 이내에 신청하실 수 있습니다.",
                KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);
        source("교환 안내", "교환은 수령 후 7일 이내에 신청하실 수 있으며 왕복 배송비 6000원이 부과됩니다.",
                KnowledgeAuthorship.AI_EXTRACTED_FROM_SELLER_IMAGE);

        KnowledgeSearchResponse found = library.search(org, productId, "교환 신청 시 왕복 배송비가 얼마인가요?", 5,
                KnowledgeVariantScope.unresolved());

        assertThat(found.passages()).isNotEmpty();
        assertThat(found.passages().get(0).authoredOrigin())
                .as("the passage that covers more of the question wins, whoever wrote it")
                .isEqualTo(KnowledgeAuthorship.AI_EXTRACTED_FROM_SELLER_IMAGE);
    }

    private void source(String title, String body, KnowledgeAuthorship origin) {
        ProductKnowledgeSource s = new ProductKnowledgeSource();
        s.setOrgId(org);
        s.setProductId(productId);
        s.setSourceType(KnowledgeSourceType.FAQ);
        s.setTitle(title);
        s.setBody(body);
        s.setAuthoredOrigin(origin);
        s.setChannelSourceRef(origin == KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE ? null : "ref-" + UUID.randomUUID());
        indexer.index(sources.save(s));
    }
}
