package com.sellerops.review.triage.feedback;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * The pilot's current additive decision for one review — the ONE row the read path consults.
 *
 * <p>Rewritten in place on every re-classification; {@link TriagePrediction} rows are the immutable
 * history. {@link #aiAttention} is the only field the list ordering reads, and RUBRIC v2 §13.7
 * item 2 says what it may do: raise a review the rule left lower, never lower one. The SQL that
 * orders the list takes {@code min(rules rank, ai rank)} and has no expression that can do the
 * other thing.
 */
@Getter
@Setter
@Entity
@Table(name = "review_triage_ai_current")
public class AiTriageCurrent extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "prediction_id", nullable = false)
    private UUID predictionId;

    @Column(name = "ai_attention", nullable = false)
    private boolean aiAttention;

    @Column(name = "classifier_version", nullable = false, length = 160)
    private String classifierVersion;

    @Column(name = "reason_code", length = 32)
    private String reasonCode;

    @Column(name = "predicted_at", nullable = false)
    private Instant predictedAt;
}
