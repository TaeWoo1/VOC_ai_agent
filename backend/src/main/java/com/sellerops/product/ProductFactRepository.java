package com.sellerops.product;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductFactRepository extends JpaRepository<ProductFact, UUID> {

    /** The upsert probe — {@code uq_product_facts_key} is (org, product, key, source). */
    Optional<ProductFact> findByOrgIdAndProductIdAndFactKeyAndSource(
            UUID orgId, UUID productId, String factKey, String source);

    List<ProductFact> findByOrgIdAndProductId(UUID orgId, UUID productId);

    List<ProductFact> findByOrgIdAndFactKeyStartingWith(UUID orgId, String prefix);

    /** The targeted read behind {@code search_product_facts} — a need asks for a few keys, not all. */
    List<ProductFact> findByOrgIdAndProductIdAndFactKeyIn(
            UUID orgId, UUID productId, Collection<String> factKeys);

    long countByOrgId(UUID orgId);
}
