package com.sellerops.sync;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SyncJobRepository extends JpaRepository<SyncJob, UUID> {
    List<SyncJob> findTop20ByOrgIdOrderByCreatedAtDesc(UUID orgId);

    /** Bounded filter window for the run-history search (filtering happens in-service). */
    List<SyncJob> findTop200ByOrgIdOrderByCreatedAtDesc(UUID orgId);

    /** Org-scoped lookup — a cross-org id reads as absent. */
    Optional<SyncJob> findByIdAndOrgId(UUID id, UUID orgId);
}
