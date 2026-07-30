package com.sellerops.agentrun;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Persistence for {@link AgentRun}, org-scoped throughout. The two {@code @Modifying} updates are
 * hand-written version-guarded conditionals — the "0 rows affected means someone else won" CAS idiom
 * (mirroring {@code ProductRepository.insertIfAbsent}) — because the claim and finalize transitions
 * need optimistic concurrency that a managed JPA {@code @Version} would not express. Both flush +
 * clear so a subsequent read reflects the write.
 */
public interface AgentRunRepository extends JpaRepository<AgentRun, UUID> {

    Optional<AgentRun> findByOrgIdAndThreadId(UUID orgId, String threadId);

    /**
     * Finalize/update a run's snapshot + status, guarded by the expected version. Returns the number of
     * rows changed: 1 on success (version bumped), 0 if the row is absent or its version has moved on
     * (a stale write — the caller fails closed).
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update AgentRun a set a.snapshot = :snapshot, a.status = :status, a.version = a.version + 1, "
            + "a.updatedAt = :now where a.orgId = :orgId and a.threadId = :threadId and a.version = :expected")
    int updateIfVersion(
            @Param("orgId") UUID orgId,
            @Param("threadId") String threadId,
            @Param("snapshot") String snapshot,
            @Param("status") String status,
            @Param("expected") long expected,
            @Param("now") Instant now);

    /**
     * Claim a run for resume by transitioning it OUT of the claimable state:
     * {@code AWAITING_APPROVAL → RESUMING} (bumping the version and stamping {@code claimed_at}). This is
     * a real lock, not just a version bump — a staggered second resume that reads the row AFTER this
     * commit sees {@code RESUMING}, so it cannot re-claim and the non-idempotent mint runs exactly once.
     * A {@code RESUMING} row whose claimer died is re-claimable once its lease elapses
     * ({@code claimed_at < :leaseCutoff}), so a crash never wedges a run. Returns 1 to exactly one live
     * claimer; a concurrent claimer (or a claim of a DONE run) sees 0 rows and must fail closed / replay.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update AgentRun a set a.status = 'RESUMING', a.version = a.version + 1, a.claimedAt = :now, "
            + "a.updatedAt = :now where a.orgId = :orgId and a.threadId = :threadId "
            + "and (a.status = 'AWAITING_APPROVAL' or (a.status = 'RESUMING' and a.claimedAt < :leaseCutoff))")
    int claimForResume(
            @Param("orgId") UUID orgId,
            @Param("threadId") String threadId,
            @Param("now") Instant now,
            @Param("leaseCutoff") Instant leaseCutoff);
}
