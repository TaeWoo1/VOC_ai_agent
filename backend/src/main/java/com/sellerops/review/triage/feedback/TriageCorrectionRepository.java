package com.sellerops.review.triage.feedback;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TriageCorrectionRepository extends JpaRepository<TriageCorrection, UUID> {

    Optional<TriageCorrection> findByPredictionId(UUID predictionId);
}
