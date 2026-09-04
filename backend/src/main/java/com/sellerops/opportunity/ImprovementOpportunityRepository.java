package com.sellerops.opportunity;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ImprovementOpportunityRepository extends JpaRepository<ImprovementOpportunity, UUID> {

    Optional<ImprovementOpportunity> findByOrgIdAndIssueIdAndKind(UUID orgId, UUID issueId, OpportunityKind kind);

    List<ImprovementOpportunity> findByOrgIdAndIssueIdIn(UUID orgId, Collection<UUID> issueIds);
}
