package com.sellerops.review.triage.feedback;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AiTriageCurrentRepository extends JpaRepository<AiTriageCurrent, UUID> {

    Optional<AiTriageCurrent> findByReviewId(UUID reviewId);

    List<AiTriageCurrent> findByOrgIdAndReviewIdIn(UUID orgId, Collection<UUID> reviewIds);

    long countByOrgIdAndReviewIdInAndAiAttentionTrue(UUID orgId, Collection<UUID> reviewIds);

    /** Every review of this org the pilot currently marks — the funnel's population. */
    List<AiTriageCurrent> findByOrgIdAndAiAttentionTrue(UUID orgId);
}
