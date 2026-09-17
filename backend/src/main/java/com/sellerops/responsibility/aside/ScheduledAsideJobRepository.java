package com.sellerops.responsibility.aside;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

/**
 * Every read is scoped to one device or one organisation. A helper asking for work may only ever be answered
 * with work queued for <em>it</em>, and the device id is derived from its validated token — never from the
 * request — so there is no shape of call here that lets one seller's helper see another's job.
 */
public interface ScheduledAsideJobRepository extends JpaRepository<ScheduledAsideJob, UUID> {

    /** The idempotency lookup: a retried hand-out re-finds its job rather than queuing a second one. */
    Optional<ScheduledAsideJob> findByDeviceIdAndClientJobId(UUID deviceId, String clientJobId);

    Optional<ScheduledAsideJob> findByIdAndDeviceId(UUID id, UUID deviceId);

    Optional<ScheduledAsideJob> findByIdAndOrgId(UUID id, UUID orgId);

    List<ScheduledAsideJob> findByRunIdOrderByCreatedAtAsc(UUID runId);

    /** What this device may take right now: queued for it, and not yet expired. At most one exists by index. */
    @Query("""
            select j from ScheduledAsideJob j
            where j.deviceId = :deviceId and j.status = com.sellerops.responsibility.aside.ScheduledAsideJobStatus.QUEUED
              and j.expiresAt > :now
            order by j.createdAt asc
            """)
    List<ScheduledAsideJob> claimableFor(@Param("deviceId") UUID deviceId, @Param("now") Instant now);

    /**
     * The single-use claim, mirroring the run lease: a conditional UPDATE that moves the row out of QUEUED.
     * Returns 0 when someone already took it, which is the fence a duplicate claim hits — the check and the
     * transition are one statement, so two helpers racing cannot both be told yes.
     */
    @Transactional
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update ScheduledAsideJob j
               set j.status = com.sellerops.responsibility.aside.ScheduledAsideJobStatus.CLAIMED,
                   j.claimedAt = :now, j.leaseUntil = :leaseUntil
             where j.id = :jobId and j.deviceId = :deviceId
               and j.status = com.sellerops.responsibility.aside.ScheduledAsideJobStatus.QUEUED
               and j.expiresAt > :now
            """)
    int claim(@Param("jobId") UUID jobId, @Param("deviceId") UUID deviceId, @Param("now") Instant now,
              @Param("leaseUntil") Instant leaseUntil);

    /**
     * Time out what nobody took and what nobody finished. An expired job is not a job that reported nothing —
     * it never ran, and the observation it was serving says so with its own reason.
     */
    @Transactional
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update ScheduledAsideJob j
               set j.status = com.sellerops.responsibility.aside.ScheduledAsideJobStatus.EXPIRED,
                   j.leaseUntil = null
             where (j.status = com.sellerops.responsibility.aside.ScheduledAsideJobStatus.QUEUED
                        and j.expiresAt <= :now)
                or (j.status = com.sellerops.responsibility.aside.ScheduledAsideJobStatus.CLAIMED
                        and j.leaseUntil <= :now)
            """)
    int expireStale(@Param("now") Instant now);
}
