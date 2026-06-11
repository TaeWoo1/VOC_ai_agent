package com.sellerops.sync;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SyncScheduleRepository extends JpaRepository<SyncSchedule, UUID> {

    List<SyncSchedule> findByOrgIdAndSellerAccountId(UUID orgId, UUID sellerAccountId);

    /**
     * Lock a bounded batch of due, enabled schedules for claiming. {@code FOR
     * UPDATE SKIP LOCKED} makes concurrent poller ticks (or instances) skip rows
     * another tick is already claiming instead of double-running them. Must be
     * called inside a transaction; the claimer advances {@code next_run_at}
     * before that transaction commits, so a later tick no longer sees the row.
     */
    @Query(value = """
            select * from sync_schedules
            where enabled = true and next_run_at <= :now
            order by next_run_at asc
            limit :limit
            for update skip locked
            """, nativeQuery = true)
    List<SyncSchedule> lockDue(@Param("now") Instant now, @Param("limit") int limit);
}
