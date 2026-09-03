package com.sellerops.knowledge.candidate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface KnowledgeCandidateRepository extends JpaRepository<KnowledgeCandidate, UUID> {

    List<KnowledgeCandidate> findAllByOrgIdAndStateOrderByEvidenceCountDescCreatedAtDesc(
            UUID orgId, String state);

    Optional<KnowledgeCandidate> findByIdAndOrgId(UUID id, UUID orgId);

    Optional<KnowledgeCandidate> findByOrgIdAndDedupeKeyAndState(UUID orgId, String dedupeKey, String state);

    long countByOrgIdAndState(UUID orgId, String state);
}
