package com.sellerops.knowledge.org;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrgKnowledgeSourceRepository extends JpaRepository<OrgKnowledgeSource, UUID> {

    List<OrgKnowledgeSource> findAllByOrgIdOrderByCreatedAtAsc(UUID orgId);

    /** Org-scoped by id — an operating rule is never reachable across a tenant boundary. */
    Optional<OrgKnowledgeSource> findByIdAndOrgId(UUID id, UUID orgId);

    long countByOrgId(UUID orgId);
}
