package com.sellerops.reviewimport;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewImportSegmentAttemptRepository extends JpaRepository<ReviewImportSegmentAttempt, UUID> {

    List<ReviewImportSegmentAttempt> findBySegmentIdOrderByAttemptNoAsc(UUID segmentId);

    /**
     * The attempt that produced a given ingest run — the launch binding {@code ExecutableIdentityResolver}
     * walks from a review's {@code acquisition_sync_job_id} back to the plan's seller account. A run that
     * no attempt links to was not a guided export, whatever its {@code method} column says.
     */
    java.util.Optional<ReviewImportSegmentAttempt> findFirstBySyncJobId(UUID syncJobId);

    /**
     * When a guided acquisition last SUCCEEDED for this org on this channel — the freshness fact that lives
     * in acquisition provenance rather than in a collection run's columns.
     *
     * <p><b>Why the coverage service asks this and not only the sync history.</b> A guided export reaches the
     * store through the file-upload seam, whose run row carries the upload's own shape; the review-import
     * attempt is the record that says a REVIEW acquisition for this account completed. Reading the incidental
     * column alone is how a channel that was verifiably read this morning still answered 「아직 확인한 적이
     * 없어요」. Nothing is written to repair the past: the true record was always here, and this is the query
     * that reads it.
     */
    @Query("""
            select max(a.finishedAt) from ReviewImportSegmentAttempt a
              join ReviewImportSegment s on s.id = a.segmentId
              join ReviewImportPlan p on p.id = s.planId
            where a.orgId = :orgId and p.channelId = :channelId
              and a.result = com.sellerops.reviewimport.SegmentAttemptResult.SUCCEEDED
            """)
    Instant lastSucceededAt(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId);

    /** Highest attempt_no for a segment (0 when none yet) — the next attempt is this + 1. */
    default int nextAttemptNo(UUID segmentId) {
        return findBySegmentIdOrderByAttemptNoAsc(segmentId).stream()
                .mapToInt(ReviewImportSegmentAttempt::getAttemptNo)
                .max()
                .orElse(0)
                + 1;
    }
}
