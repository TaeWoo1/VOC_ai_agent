package com.sellerops.reviewimport;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewImportPlanRepository extends JpaRepository<ReviewImportPlan, UUID> {

    /** Org-scoped read — a cross-org id reads as absent, so the org filter is authorization, not tidiness. */
    Optional<ReviewImportPlan> findByIdAndOrgId(UUID id, UUID orgId);

    List<ReviewImportPlan> findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(UUID orgId, UUID sellerAccountId);

    List<ReviewImportPlan> findByOrgIdOrderByCreatedAtDesc(UUID orgId);
}
