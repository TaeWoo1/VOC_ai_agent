package com.sellerops.product.library;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>A seller must be able to correct a document they already saved.</b>
 *
 * <p>Found live on 2026-09-03: {@code PUT /api/products/knowledge/sources/{id}} answered 500 with
 * {@code duplicate key value violates constraint "uq_pk_chunks_ordinal"}. Re-indexing deleted the old
 * passages and wrote the new ones in one transaction, and Hibernate runs every insert before any
 * delete — so the second ordinal 1 met the first. Adding knowledge worked, which is why it was never
 * noticed; the failure is on the second save of the same document, and this test is the second save.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductKnowledgeReindexTest {

    @Autowired ProductKnowledgeChunkRepository chunks;
    @Autowired ProductKnowledgeSourceRepository sources;
    @Autowired ProductRepository products;
    @Autowired OrganizationRepository organizations;

    @Test
    @DisplayName("indexing the same document twice replaces its passages instead of colliding")
    void aDocumentCanBeCorrected() {
        Organization org = new Organization();
        org.setName("재색인 " + UUID.randomUUID());
        UUID orgId = organizations.save(org).getId();
        Product product = new Product();
        product.setOrgId(orgId);
        product.setName("케이블 몰딩");
        product.setStatus("ACTIVE");
        UUID productId = products.save(product).getId();

        ProductKnowledgeSource source = new ProductKnowledgeSource();
        source.setOrgId(orgId);
        source.setProductId(productId);
        source.setSourceType(KnowledgeSourceType.DESCRIPTION);
        source.setAuthoredOrigin(KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);
        source.setTitle("규격 안내");
        source.setBody("1호는 두께 1.2mm입니다. 2호는 두께 1.6mm입니다.\n\n3호는 두께 2.0mm입니다.");
        ProductKnowledgeSource saved = sources.save(source);

        ProductKnowledgeIndexer indexer = new ProductKnowledgeIndexer(chunks);
        assertThat(indexer.index(saved)).isPositive();

        // The seller corrects it. This is the call that used to throw.
        saved.setBody("이 상품은 단일 규격이며 두께는 3.0mm 하나뿐입니다.");
        int after = indexer.index(saved);

        assertThat(after).isEqualTo(1);
        assertThat(chunks.countBySourceId(saved.getId())).isEqualTo(1);
        assertThat(chunks.findAllByOrgIdAndProductId(orgId, productId))
                .singleElement()
                .satisfies(c -> assertThat(c.getContent()).contains("3.0mm"));
    }
}
