package com.sellerops.sync;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SyncJobRepository extends JpaRepository<SyncJob, UUID> {
    List<SyncJob> findTop20ByOrgIdOrderByCreatedAtDesc(UUID orgId);
}
