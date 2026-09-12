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

    /** The same count, narrowed to what can actually ground an answer — see the product-scoped twin. */
    long countByOrgIdAndActiveTrue(UUID orgId);

    /** How many operating rules a person wrote — the 운영 기준 number. See the product repository's note. */
    long countByOrgIdAndDocumentNameIsNull(UUID orgId);

    /** How many uploaded files landed in the org corpus — the 자료 number, org side. */
    long countByOrgIdAndDocumentNameIsNotNull(UUID orgId);
}
