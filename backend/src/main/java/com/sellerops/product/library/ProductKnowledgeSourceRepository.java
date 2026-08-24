package com.sellerops.product.library;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductKnowledgeSourceRepository extends JpaRepository<ProductKnowledgeSource, UUID> {

    List<ProductKnowledgeSource> findAllByOrgIdAndProductIdOrderByCreatedAtAsc(UUID orgId, UUID productId);

    /** Org-scoped by id — a knowledge document is never reachable across a tenant boundary. */
    Optional<ProductKnowledgeSource> findByIdAndOrgId(UUID id, UUID orgId);

    long countByOrgIdAndProductId(UUID orgId, UUID productId);
}
