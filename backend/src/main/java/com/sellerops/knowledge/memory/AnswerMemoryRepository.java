package com.sellerops.knowledge.memory;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AnswerMemoryRepository extends JpaRepository<AnswerMemory, UUID> {

    List<AnswerMemory> findAllByOrgId(UUID orgId);

    Optional<AnswerMemory> findByOrgIdAndOriginRef(UUID orgId, String originRef);

    long countByOrgId(UUID orgId);
}
