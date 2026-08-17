package com.sellerops.review.triage.feedback;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TriageCorrectionRepository extends JpaRepository<TriageCorrection, UUID> {

    Optional<TriageCorrection> findByPredictionId(UUID predictionId);

    Optional<TriageCorrection> findByReviewId(UUID reviewId);

    List<TriageCorrection> findByOrgIdAndReviewIdIn(UUID orgId, Collection<UUID> reviewIds);

    /** Corrections made while the pilot's mark was what was shown, over these reviews. */
    List<TriageCorrection> findByOrgIdAndShownSourceAndReviewIdIn(UUID orgId, TriageShownSource shown,
                                                                  Collection<UUID> reviewIds);
}
