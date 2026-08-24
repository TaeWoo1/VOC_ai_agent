package com.sellerops.product.library;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductKnowledgeChunkRepository extends JpaRepository<ProductKnowledgeChunk, UUID> {

    /**
     * Every passage of one product. The corpus is bounded by construction — one product's own
     * documents — which is what lets scoring happen in memory and stay deterministic.
     */
    List<ProductKnowledgeChunk> findAllByOrgIdAndProductId(UUID orgId, UUID productId);

    void deleteAllBySourceId(UUID sourceId);
}
