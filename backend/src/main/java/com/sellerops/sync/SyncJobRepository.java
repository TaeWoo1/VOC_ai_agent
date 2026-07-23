package com.sellerops.sync;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SyncJobRepository extends JpaRepository<SyncJob, UUID> {
    List<SyncJob> findTop20ByOrgIdOrderByCreatedAtDesc(UUID orgId);

    /** Bounded filter window for the run-history search (filtering happens in-service). */
    List<SyncJob> findTop200ByOrgIdOrderByCreatedAtDesc(UUID orgId);

    /**
     * The org's most recent REVIEW imports, newest first — filtered in SQL, then limited.
     *
     * <p><b>The order of those two matters.</b> The sibling reads above fetch a fixed window and
     * leave filtering to the caller, so a busy org can push its review imports out of the window
     * before the filter ever runs — the seller then sees an empty history for imports that exist.
     * Here the predicate is part of the query and {@code pageable} bounds the result after it, so
     * the newest N review imports are the newest N review imports.
     *
     * <p><b>The predicate is exact, not heuristic.</b> {@code FileUploadConnector} is the only writer
     * that sets {@code uploadType} at all, so {@code jobType='FILE_UPLOAD' AND uploadType='REVIEW'}
     * selects precisely the file/export review imports and nothing else. It deliberately does NOT
     * filter on {@code dataType} or {@code sellerAccountId}: an upload carries {@code null} for both
     * (see {@code FileUploadConnector.uploadDescriptor}), which is exactly why the existing
     * run-history filters cannot see uploads.
     *
     * <p>Ordering is <b>deterministic</b>, and it sorts by the same instant the surface displays:
     * {@code finishedAt} where the import ended, falling back to {@code createdAt} while it has not,
     * with {@code id desc} as the tiebreaker. Sorting on one timestamp while labelling rows with
     * another is how a list ends up showing an older date above a newer one — two overlapping
     * imports (one long, one short) would otherwise render in an order the dates contradict.
     */
    @Query("""
            select j from SyncJob j
            where j.orgId = :orgId and j.jobType = 'FILE_UPLOAD' and j.uploadType = 'REVIEW'
            order by coalesce(j.finishedAt, j.createdAt) desc, j.id desc
            """)
    List<SyncJob> findReviewImports(@Param("orgId") UUID orgId, Pageable pageable);

    /** Org-scoped lookup — a cross-org id reads as absent. */
    Optional<SyncJob> findByIdAndOrgId(UUID id, UUID orgId);
}
