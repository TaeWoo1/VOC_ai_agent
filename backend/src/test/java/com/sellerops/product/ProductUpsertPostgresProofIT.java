package com.sellerops.product;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Disposable-Postgres proof for the product upsert — the one statement in this repository that H2
 * cannot vouch for.
 *
 * <p><b>Why this class exists.</b> {@code insertIfAbsent} is a native {@code MERGE} whose row source is
 * a {@code VALUES} constructor. A bare parameter inside one has no column to take its type from:
 * H2 infers it, PostgreSQL resolves it to {@code text}, and the failure surfaces far from the cause as
 * "column created_at is of type timestamp with time zone but expression is of type text". Every existing
 * test for this path runs on H2 and passed throughout.
 *
 * <p>It stayed invisible because the statement is only reached when a genuinely NEW sku appears — an
 * already-resolved sku short-circuits before it. On the canonical demo org that moment was the Cafe24
 * review promotion: 133 real board-4 articles promoted none, across three consecutive sync runs, each
 * failure swallowed as a warning by a bridge that is deliberately non-fatal.
 *
 * <p><b>Opt-in only</b>, like {@code ChannelOrderPostgresProofIT}: gated on {@code SELLEROPS_PG_PROOF=1}
 * so the ordinary gate and CI, which have no Postgres, are unaffected.
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "SELLEROPS_PG_PROOF", matches = "1")
class ProductUpsertPostgresProofIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String url = System.getenv().getOrDefault("SELLEROPS_PG_URL",
                "jdbc:postgresql://localhost:55432/sellerops");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> "sellerops");
        registry.add("spring.datasource.password", () -> "sellerops_local_pw");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    @Autowired ProductRepository products;
    @Autowired ProductService productService;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager txManager;

    /**
     * The class is deliberately NOT {@code @Transactional} (rows persist for psql inspection), but a
     * {@code @Modifying} native statement still needs one — so each call gets its own, exactly as the
     * production callers run it inside the enclosing ingest transaction.
     */
    private <T> T inTx(java.util.function.Supplier<T> work) {
        return new TransactionTemplate(txManager).execute(status -> work.get());
    }

    private UUID seedOrg() {
        UUID orgId = UUID.randomUUID();
        jdbc.update("insert into organizations (id, name, created_at, updated_at) "
                + "values (?, ?, now(), now())", orgId, "pg-upsert-proof");
        return orgId;
    }

    @Test
    void aBrandNewSkuInsertsOnPostgres() {
        UUID orgId = seedOrg();
        String sku = "pg-" + UUID.randomUUID();

        int written = inTx(() -> products.insertIfAbsent(UUID.randomUUID(), orgId, "새 상품", sku, Instant.now()));

        assertThat(written).isEqualTo(1);
        assertThat(products.findByOrgIdAndSku(orgId, sku)).isPresent();
    }

    @Test
    void theTimestampLandsAsATimestampNotAsText() {
        UUID orgId = seedOrg();
        String sku = "pg-" + UUID.randomUUID();
        Instant now = Instant.parse("2026-08-22T05:41:09Z");

        inTx(() -> products.insertIfAbsent(UUID.randomUUID(), orgId, "새 상품", sku, now));

        // The whole point of the cast: read it back as an instant, which a text-typed insert could
        // never have produced because it would not have inserted at all.
        Instant stored = jdbc.queryForObject(
                "select created_at from products where org_id = ? and sku = ?", Instant.class, orgId, sku);
        assertThat(stored).isEqualTo(now);
    }

    @Test
    void aSecondCallForTheSameSkuIsANoOpRatherThanAViolation() {
        UUID orgId = seedOrg();
        String sku = "pg-" + UUID.randomUUID();
        inTx(() -> products.insertIfAbsent(UUID.randomUUID(), orgId, "첫 이름", sku, Instant.now()));

        int second = inTx(() -> products.insertIfAbsent(UUID.randomUUID(), orgId, "다른 이름", sku, Instant.now()));

        // WHEN NOT MATCHED only: a concurrent creator never poisons the enclosing transaction, and the
        // existing product's name is never overwritten.
        assertThat(second).isZero();
        assertThat(products.findByOrgIdAndSku(orgId, sku)).get()
                .extracting(Product::getName).isEqualTo("첫 이름");
    }

    /** A product created by this path is the seller's own data — the filter must not hide it. */
    @Test
    void aProductCreatedByTheUpsertIsRealAndVisible() {
        UUID orgId = seedOrg();
        String sku = "pg-" + UUID.randomUUID();

        Product resolved = inTx(() -> productService.resolveOrCreateWithinTransaction(orgId, "상품", sku));

        assertThat(resolved).isNotNull();
        assertThat(resolved.getDataOrigin()).isEqualTo(com.sellerops.common.DataOrigin.REAL);
    }
}
