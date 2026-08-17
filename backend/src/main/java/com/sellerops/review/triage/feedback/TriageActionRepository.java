package com.sellerops.review.triage.feedback;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TriageActionRepository extends JpaRepository<TriageAction, UUID> {

    List<TriageAction> findByReviewIdOrderByActedAtDesc(UUID reviewId);

    List<TriageAction> findByOrgIdAndSnapshotVersionIsNull(UUID orgId);

    /** Distinct reviews with this action, recorded while the pilot's mark was what was shown. */
    @Query("""
            select count(distinct a.reviewId) from TriageAction a
            where a.orgId = :orgId and a.kind = :kind and a.shownSource = :shown
              and a.reviewId in :reviewIds
            """)
    long countDistinctReviews(@Param("orgId") UUID orgId, @Param("kind") TriageActionKind kind,
                              @Param("shown") TriageShownSource shown, @Param("reviewIds") List<UUID> reviewIds);
}
