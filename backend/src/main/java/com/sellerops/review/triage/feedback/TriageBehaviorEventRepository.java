package com.sellerops.review.triage.feedback;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TriageBehaviorEventRepository extends JpaRepository<TriageBehaviorEvent, UUID> {

    List<TriageBehaviorEvent> findByOrgIdAndSnapshotVersionIsNull(UUID orgId);

    List<TriageBehaviorEvent> findByReviewIdOrderByOccurredAtAsc(UUID reviewId);

    /**
     * Distinct reviews of this org that produced this kind of event WHILE the pilot's mark was what
     * was shown. The funnel counts reviews, never events: a row opened five times is one review that
     * was opened.
     */
    @Query("""
            select count(distinct e.reviewId) from TriageBehaviorEvent e
            where e.orgId = :orgId and e.kind = :kind and e.shownSource = :shown
              and e.reviewId in :reviewIds
            """)
    long countDistinctReviews(@Param("orgId") UUID orgId, @Param("kind") TriageBehaviorKind kind,
                              @Param("shown") TriageShownSource shown, @Param("reviewIds") List<UUID> reviewIds);
}
