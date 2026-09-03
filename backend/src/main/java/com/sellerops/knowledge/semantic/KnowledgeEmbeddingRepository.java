package com.sellerops.knowledge.semantic;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface KnowledgeEmbeddingRepository extends JpaRepository<KnowledgeEmbedding, UUID> {

    List<KnowledgeEmbedding> findAllByOrgIdAndModelAndDimensionsAndContentSha256In(
            UUID orgId, String model, int dimensions, Collection<String> hashes);
}
