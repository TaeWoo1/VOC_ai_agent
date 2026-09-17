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
     * The most recent observation of one data type that actually established something, from any earlier run.
     *
     * <p>This is the baseline a later read is compared against — how «nothing changed» is known to be a fact
     * about the surface rather than about our memory. Only {@code COMPLETE} rows qualify: a read that never
     * finished cannot be the thing a later read is said to differ from.
     */
    @Query("""
            select s from ResponsibilityRunSource s
            where s.orgId = :orgId and s.dataType = :dataType and s.runId <> :runId
              and s.completeness = com.sellerops.responsibility.SourceCompleteness.COMPLETE
            order by s.observedAt desc
            """)
    List<ResponsibilityRunSource> latestSettledOfType(@Param("orgId") UUID orgId,
                                                      @Param("dataType") String dataType,
                                                      @Param("runId") UUID runId,
                                                      org.springframework.data.domain.Pageable page);

    /**
     * The baseline for a DEVICE-carried read: the newest settled observation of one account's surface, by the
     * same method, from an earlier run.
     *
     * <p><b>Why this is not {@link #latestSettledOfType}.</b> That query is scoped by organisation and data type,
     * which was unambiguous while the only device read had a data type no channel uses. It is not unambiguous
     * now: an unattended Coupang review read records {@code REVIEW}, and so does this organisation's Cafe24 API
     * collection. Asked the old way, the Coupang digest would be compared against a Cafe24 row — and «nothing
     * changed» would be a statement about the wrong store. The account and the method are what make the two
     * tellable apart, so both are conditions.
     *
     * <p>{@code BOUNDED} counts as settled here, unlike the org-wide query above: a marketplace read is bounded by the
     * screen's period by design, so a COMPLETE-only baseline would never exist for it (found live — Run B's
     * {@code cursor_from} came back empty after a settled Run A).
     */
    @Query("""
            select s from ResponsibilityRunSource s
            where s.orgId = :orgId and s.sellerAccountId = :accountId and s.dataType = :dataType
              and s.method = :method and s.runId <> :runId
              and s.completeness in (com.sellerops.responsibility.SourceCompleteness.COMPLETE,
                                     com.sellerops.responsibility.SourceCompleteness.BOUNDED)
            order by s.observedAt desc
            """)
    List<ResponsibilityRunSource> latestSettledDeviceRead(@Param("orgId") UUID orgId,
                                                          @Param("accountId") UUID accountId,
                                                          @Param("dataType") String dataType,
                                                          @Param("method") String method,
                                                          @Param("runId") UUID runId,
                                                          org.springframework.data.domain.Pageable page);

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
