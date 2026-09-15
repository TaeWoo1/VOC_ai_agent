package com.sellerops.responsibility;

import com.sellerops.sync.SyncJob;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ResponsibilityRunSourceRepository extends JpaRepository<ResponsibilityRunSource, UUID> {

    List<ResponsibilityRunSource> findByRunIdOrderByAttemptAscCreatedAtAsc(UUID runId);

    List<ResponsibilityRunSource> findByRunIdInOrderByAttemptAscCreatedAtAsc(Collection<UUID> runIds);

    List<ResponsibilityRunSource> findByRunIdAndSellerAccountIdAndDataTypeOrderByAttemptDesc(
            UUID runId, UUID sellerAccountId, String dataType);

    /**
     * The sync jobs this runtime started for one (account, data type) since an instant, newest first. Used only
     * to recover an observation whose attempt died: the job it started is either finished (adopt it — the read
     * happened) or still RUNNING with no living owner (an orphan to close).
     */
    @Query("""
            select j from SyncJob j
            where j.sellerAccountId = :accountId and j.dataType = :dataType and j.trigger = :trigger
              and j.createdAt >= :since
            order by j.createdAt desc
            """)
    List<SyncJob> findTriggeredSyncJobsSince(@Param("accountId") UUID accountId,
                                             @Param("dataType") String dataType,
                                             @Param("trigger") String trigger,
                                             @Param("since") Instant since);
}
