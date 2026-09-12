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
 * <p><b>One live row per review, and it is no longer deleted from.</b> {@link #state} says whether the
 * seller's word currently stands ({@link SellerCorrectionState}); the append-only
 * {@link TriageCorrectionAudit} says what it said before. Withdrawing is a state change rather than a
 * delete because a delete would cascade into {@link CorrectionDisposition} and could take a row out of
 * a frozen evaluation snapshot.
 *
 * <p><b>The seller chooses among all three tiers.</b> Until 2026-09-11 the write path took a boolean
 * and derived the rest, so a seller who meant 참고 had 지켜보기 recorded for them. The column always
 * held three values; only the caller was binary. See {@code V99__seller_triage_correction.sql} for the
 * decision this reverses and why.
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

    /** Whether this correction currently stands. Only {@code STANDING} may be acted on. */
    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false, length = 16)
    private SellerCorrectionState state = SellerCorrectionState.STANDING;

    /** True when the seller's word stands — the one question every read path here asks. */
    public boolean stands() {
        return state == SellerCorrectionState.STANDING;
    }
}
