package com.sellerops.reviewimport;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewImportSegmentAttemptRepository extends JpaRepository<ReviewImportSegmentAttempt, UUID> {

    List<ReviewImportSegmentAttempt> findBySegmentIdOrderByAttemptNoAsc(UUID segmentId);

    /** Highest attempt_no for a segment (0 when none yet) — the next attempt is this + 1. */
    default int nextAttemptNo(UUID segmentId) {
        return findBySegmentIdOrderByAttemptNoAsc(segmentId).stream()
                .mapToInt(ReviewImportSegmentAttempt::getAttemptNo)
                .max()
                .orElse(0)
                + 1;
    }
}
