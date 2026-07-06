package com.sellerops.product;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProductRepository extends JpaRepository<Product, UUID> {
    List<Product> findAllByOrgId(UUID orgId);

    Optional<Product> findByOrgIdAndSku(UUID orgId, String sku);

    Optional<Product> findFirstByOrgIdAndName(UUID orgId, String name);

    /**
     * Insert a product only if its {@code (org_id, sku)} is not already present — a
     * transaction-safe upsert primitive using SQL-standard {@code MERGE} (supported by
     * both PostgreSQL 15 and H2). With only a {@code WHEN NOT MATCHED THEN INSERT}
     * branch, an already-present row is a no-op (0 rows) rather than a constraint
     * violation, so a concurrent creation of the same SKU never poisons the enclosing
     * transaction and never overwrites the existing product's name. Callers re-select
     * the row afterwards.
     */
    @Modifying
    @Query(value = "merge into products t "
            + "using (values (:id, :orgId, :name, :sku, :now)) s(id, org_id, name, sku, ts) "
            + "on t.org_id = s.org_id and t.sku = s.sku "
            + "when not matched then insert (id, org_id, name, sku, status, created_at, updated_at) "
            + "values (s.id, s.org_id, s.name, s.sku, 'ACTIVE', s.ts, s.ts)",
            nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("orgId") UUID orgId, @Param("name") String name,
                       @Param("sku") String sku, @Param("now") Instant now);
}
