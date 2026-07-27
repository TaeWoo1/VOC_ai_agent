package com.sellerops.reviewimport;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewImportPlanRepository extends JpaRepository<ReviewImportPlan, UUID> {

    /** Org-scoped read — a cross-org id reads as absent, so the org filter is authorization, not tidiness. */
    Optional<ReviewImportPlan> findByIdAndOrgId(UUID id, UUID orgId);

    /**
     * The same org-scoped read, but taking a PESSIMISTIC_WRITE row lock on the plan. Forward-extension
     * uses this to serialize concurrent extends of one plan: two requests that would each materialize the
     * same forward month are ordered, so the second re-reads the segments the first added and no-ops
     * instead of inserting a duplicate. The DB row lock serializes across app instances too, not just
     * within one JVM.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from ReviewImportPlan p where p.id = :id and p.orgId = :orgId")
    Optional<ReviewImportPlan> findByIdAndOrgIdForUpdate(@Param("id") UUID id, @Param("orgId") UUID orgId);

    List<ReviewImportPlan> findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(UUID orgId, UUID sellerAccountId);

    List<ReviewImportPlan> findByOrgIdOrderByCreatedAtDesc(UUID orgId);
}
