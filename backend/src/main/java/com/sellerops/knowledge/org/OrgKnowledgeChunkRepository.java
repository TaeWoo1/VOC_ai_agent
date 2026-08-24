package com.sellerops.knowledge.org;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

public interface OrgKnowledgeChunkRepository extends JpaRepository<OrgKnowledgeChunk, UUID> {

    List<OrgKnowledgeChunk> findAllByOrgId(UUID orgId);

    @Transactional
    void deleteAllBySourceId(UUID sourceId);
}
