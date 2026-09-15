package com.sellerops.responsibility;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ResponsibilityRunRepository extends JpaRepository<ResponsibilityRun, UUID> {

    Optional<ResponsibilityRun> findByResponsibilityIdAndWindowStart(UUID responsibilityId, Instant windowStart);

    List<ResponsibilityRun> findByResponsibilityIdOrderByWindowStartAsc(UUID responsibilityId);

    List<ResponsibilityRun> findTop20ByResponsibilityIdOrderByWindowStartDesc(UUID responsibilityId);

    List<ResponsibilityRun> findByResponsibilityIdAndStatusIn(UUID responsibilityId, Collection<RunStatus> statuses);

    /**
     * Runs that may be claimed now: queued, abandoned by a holder whose lease expired, or waiting for a retry
     * whose time has come. Oldest window first. {@code SKIP LOCKED} keeps two instances off the same row; the
     * partial unique index {@code uq_responsibility_run_active} keeps them off the same responsibility.
     */
    @Query(value = """
            select * from responsibility_run
            where status = 'PENDING'
               or (status = 'RUNNING' and lease_until < :now)
               or (status in ('PARTIAL', 'FAILED') and next_attempt_at is not null and next_attempt_at <= :now)
            order by window_start asc
            limit :limit
            for update skip locked
            """, nativeQuery = true)
    List<ResponsibilityRun> lockClaimable(@Param("now") Instant now, @Param("limit") int limit);

    /** Whether another run of this responsibility is RUNNING under a live lease. */
    @Query("""
            select count(r) > 0 from ResponsibilityRun r
            where r.responsibilityId = :responsibilityId and r.id <> :runId
              and r.status = com.sellerops.responsibility.RunStatus.RUNNING and r.leaseUntil >= :now
            """)
    boolean existsLiveRunningOther(@Param("responsibilityId") UUID responsibilityId,
                                   @Param("runId") UUID runId, @Param("now") Instant now);

    /** Heartbeat. Returns 0 when this owner no longer holds the run — the fence a reclaimed holder hits. */
    @Modifying
    @Query("""
            update ResponsibilityRun r set r.leaseUntil = :until
            where r.id = :runId and r.leaseOwner = :owner
              and r.status = com.sellerops.responsibility.RunStatus.RUNNING
            """)
    int renewLease(@Param("runId") UUID runId, @Param("owner") String owner, @Param("until") Instant until);
}
