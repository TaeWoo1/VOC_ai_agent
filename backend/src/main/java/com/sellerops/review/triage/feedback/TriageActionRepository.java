package com.sellerops.review.triage.feedback;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TriageActionRepository extends JpaRepository<TriageAction, UUID> {

    List<TriageAction> findByReviewIdOrderByActedAtDesc(UUID reviewId);

    List<TriageAction> findByOrgIdAndSnapshotVersionIsNull(UUID orgId);
}
