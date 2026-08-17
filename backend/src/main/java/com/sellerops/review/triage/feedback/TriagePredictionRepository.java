package com.sellerops.review.triage.feedback;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TriagePredictionRepository extends JpaRepository<TriagePrediction, UUID> {

    /**
     * The current answer for a review: the most recent prediction, whatever its status.
     *
     * <p>"Whatever its status" on purpose. Skipping past a {@code CLASSIFICATION_FAILED} row to the
     * last successful one would present a stale judgment as the current one and hide the outage —
     * which is the same silent-dismissal failure RUBRIC v2 §8.5 forbids at the other end.
     */
    Optional<TriagePrediction> findFirstByReviewIdOrderByPredictedAtDesc(UUID reviewId);

    long countByOrgIdAndClassifierVersion(UUID orgId, String classifierVersion);
}
