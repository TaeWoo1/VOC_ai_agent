package com.sellerops.review.triage.feedback;

import com.sellerops.common.BaseEntity;
import com.sellerops.review.triage.ReviewTriageTier;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * What the seller changed a prediction to.
 *
 * <p><b>Scoped to the prediction, not the review.</b> A correction attached only to a review becomes
 * uninterpretable the moment a second classifier version has run — it would say what the seller
 * wanted without saying what they were disagreeing with.
 *
 * <p><b>No free-text note, deliberately.</b> A note here is customer-adjacent prose in a table an
 * evaluation harness reads, and the reason for a correction that matters is the disposition
 * ({@link CorrectionDisposition}), which is a closed judgment about the classifier rather than about the
 * review.
 */
@Getter
@Setter
@Entity
@Table(name = "review_triage_corrections")
public class TriageCorrection extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "prediction_id", nullable = false)
    private UUID predictionId;

    @Enumerated(EnumType.STRING)
    @Column(name = "corrected_tier", nullable = false, length = 24)
    private ReviewTriageTier correctedTier;

    @Column(name = "corrected_reason_code", length = 32)
    private String correctedReasonCode;

    @Column(name = "corrected_tags", length = 64)
    private String correctedTags;

    @Column(name = "corrected_at", nullable = false)
    private Instant correctedAt;
}
