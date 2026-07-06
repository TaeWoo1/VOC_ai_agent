package com.sellerops.product;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The transaction-safe product upsert used by the ESM import: SKU is the identity,
 * names never merge products, leading zeros survive, and a unique conflict is a no-op
 * (never a constraint violation) so it can run inside a larger transaction without
 * leaving it rollback-only.
 */
@DataJpaTest
@ActiveProfiles("test")
class ProductServiceUpsertTest {

    @Autowired ProductRepository products;
    private ProductService service;
    private final UUID org = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new ProductService(products);
    }

    @Test
    void resolvesIdempotentlyBySkuWithoutRenaming() {
        Product first = service.resolveOrCreateWithinTransaction(org, "이름1", "SKU-1");
        Product again = service.resolveOrCreateWithinTransaction(org, "완전히 다른 이름", "SKU-1");

        assertThat(again.getId()).isEqualTo(first.getId());
        assertThat(again.getName()).isEqualTo("이름1");     // not merged/renamed by the second call
        assertThat(products.count()).isEqualTo(1);
    }

    @Test
    void differentSkusCreateDistinctProductsEvenWithSameNameAndKeepLeadingZeros() {
        service.resolveOrCreateWithinTransaction(org, "같은 이름", "0001");
        service.resolveOrCreateWithinTransaction(org, "같은 이름", "0002");

        assertThat(products.count()).isEqualTo(2);
        assertThat(products.findByOrgIdAndSku(org, "0001")).isPresent();   // leading zero preserved
        assertThat(products.findByOrgIdAndSku(org, "0002")).isPresent();
    }

    @Test
    void conflictingInsertIsANoOpAndDoesNotPoisonTheTransaction() {
        Product existing = new Product();
        existing.setOrgId(org);
        existing.setName("기존");
        existing.setSku("DUP-SKU");
        existing.setStatus("ACTIVE");
        products.saveAndFlush(existing);

        // ON CONFLICT DO NOTHING: a duplicate (org, sku) insert affects 0 rows, no throw.
        int affected = products.insertIfAbsent(UUID.randomUUID(), org, "다른 이름", "DUP-SKU", Instant.now());
        assertThat(affected).isZero();

        // The transaction is still usable — a subsequent write succeeds.
        Product other = new Product();
        other.setOrgId(org);
        other.setName("다음");
        other.setSku("OTHER-SKU");
        other.setStatus("ACTIVE");
        products.saveAndFlush(other);

        assertThat(products.findByOrgIdAndSku(org, "OTHER-SKU")).isPresent();
        assertThat(products.findByOrgIdAndSku(org, "DUP-SKU")).get()
                .extracting(Product::getName).isEqualTo("기존");   // original kept, not overwritten
    }
}
