package com.sellerops.review.triage.feedback;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TriageCorrectionAuditRepository extends JpaRepository<TriageCorrectionAudit, UUID> {

    /** One review's trail, oldest first — the order a person reads a history in. */
    List<TriageCorrectionAudit> findByReviewIdOrderByDecidedAtAsc(UUID reviewId);

    long countByReviewId(UUID reviewId);
}
