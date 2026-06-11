package com.sellerops.sync;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SyncScheduleRepository extends JpaRepository<SyncSchedule, UUID> {

    List<SyncSchedule> findByOrgIdAndSellerAccountId(UUID orgId, UUID sellerAccountId);
}
