package com.sellerops.knowledge.org;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrgKnowledgeSourceRepository extends JpaRepository<OrgKnowledgeSource, UUID> {

    List<OrgKnowledgeSource> findAllByOrgIdOrderByCreatedAtAsc(UUID orgId);

    /** Org-scoped by id — an operating rule is never reachable across a tenant boundary. */
    Optional<OrgKnowledgeSource> findByIdAndOrgId(UUID id, UUID orgId);

    /** Every rule that came from an uploaded file — the 자료 list, org side. */
    List<OrgKnowledgeSource> findAllByOrgIdAndDocumentNameIsNotNull(UUID orgId);

    long countByOrgId(UUID orgId);
}
