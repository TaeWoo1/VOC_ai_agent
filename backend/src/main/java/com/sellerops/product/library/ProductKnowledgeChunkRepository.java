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

    /**
     * Every passage this org has written about any product.
     *
     * <p>Not a retrieval corpus — retrieval is always scoped to one product. This is read to build
     * the seller's own VOCABULARY, which is the fence that keeps customer identifiers out of answer
     * memory ({@code TopicSignature}).
     */
    List<ProductKnowledgeChunk> findAllByOrgId(UUID orgId);

    void deleteAllBySourceId(UUID sourceId);
}
