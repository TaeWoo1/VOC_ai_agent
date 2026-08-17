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
 * <p><b>Scoped to the review, and it says what was on screen.</b> V41 scoped this to a prediction so
 * a correction always said which answer it corrected. The pilot (RUBRIC v2 §13.7) adds the case that
 * did not cover — a seller correcting a 확인 필요 the RULE produced, on a review no classifier has
 * seen — so the row now names the review, records {@link #shownTier} and {@link #shownSource}, and
 * keeps {@link #predictionId} where one exists. "What was the seller disagreeing with" is still
 * answered, by those two columns rather than by a foreign key.
 *
 * <p><b>Strong evidence</b> in the sense of the feedback draft §7: the seller answered a question.
 * It is still not gold (draft §3), and it still says nothing about WHY until a human dispositions it
 * as {@code CLASSIFIER_ERROR} or {@code SELLER_PREFERENCE}.
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

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    /** The prediction on screen at the time, or null when the tier shown was the rule's alone. */
    @Column(name = "prediction_id")
    private UUID predictionId;

    /** The tier the seller was looking at when they corrected it. */
    @Enumerated(EnumType.STRING)
    @Column(name = "shown_tier", length = 24)
    private ReviewTriageTier shownTier;

    /** Which mechanism put that tier there. */
    @Enumerated(EnumType.STRING)
    @Column(name = "shown_source", length = 8)
    private TriageShownSource shownSource;

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
