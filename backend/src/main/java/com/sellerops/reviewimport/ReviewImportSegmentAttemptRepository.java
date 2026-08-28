package com.sellerops.reviewimport;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewImportSegmentAttemptRepository extends JpaRepository<ReviewImportSegmentAttempt, UUID> {

    List<ReviewImportSegmentAttempt> findBySegmentIdOrderByAttemptNoAsc(UUID segmentId);

    /**
     * The attempt that produced a given ingest run — the launch binding {@code ExecutableIdentityResolver}
     * walks from a review's {@code acquisition_sync_job_id} back to the plan's seller account. A run that
     * no attempt links to was not a guided export, whatever its {@code method} column says.
     */
    java.util.Optional<ReviewImportSegmentAttempt> findFirstBySyncJobId(UUID syncJobId);

    /** Highest attempt_no for a segment (0 when none yet) — the next attempt is this + 1. */
    default int nextAttemptNo(UUID segmentId) {
        return findBySegmentIdOrderByAttemptNoAsc(segmentId).stream()
                .mapToInt(ReviewImportSegmentAttempt::getAttemptNo)
                .max()
                .orElse(0)
                + 1;
    }
}
