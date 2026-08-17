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

    /** The funnel's population: reviews on this channel the pilot currently marks — one query. */
    @org.springframework.data.jpa.repository.Query("""
            select a.reviewId from AiTriageCurrent a
            join com.sellerops.review.Review r on r.id = a.reviewId
            where a.orgId = :orgId and r.channelId = :channelId and a.aiAttention = true
            """)
    List<UUID> findMarkedReviewIds(@org.springframework.data.repository.query.Param("orgId") UUID orgId,
                                   @org.springframework.data.repository.query.Param("channelId") UUID channelId);
}
