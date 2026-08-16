package com.sellerops.review.triage.feedback;

import com.sellerops.common.BaseEntity;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.llm.ReviewTriageClassifier;
import com.sellerops.review.triage.llm.TriageSuggestedAction;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * What the classifier said about one review, and what produced it.
 *
 * <p><b>Immutable by intent.</b> Nothing updates one of these; a re-classification inserts a new
 * row. There is no setter-driven "refresh" path and there should not be one — a prediction edited in
 * place makes "was the model wrong, or did the model change" unanswerable, and that is the only
 * question this table is for.
 *
 * <p><b>It carries no review content.</b> Not the body, not the prompt, not the raw response. The
 * one string that could have leaked is {@code failureReason}, which is why it holds this codebase's
 * own short shape-of-the-error phrase and never a vendor message: a vendor error body can quote the
 * request, and the request contains the review.
 */
@Getter
@Setter
@Entity
@Table(name = "review_triage_predictions")
public class TriagePrediction extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private ReviewTriageClassifier.Status status;

    /** Null on any status but OK. Never FYI-by-default — RUBRIC v2 §8.5. */
    @Enumerated(EnumType.STRING)
    @Column(length = 24)
    private ReviewTriageTier tier;

    @Column(name = "reason_code", length = 32)
    private String reasonCode;

    /**
     * Zero to two categories, comma-joined. A join rather than a child table because the vocabulary
     * is closed and capped at two by contract, so the row can never grow and the only query anyone
     * has needed is "what did it say about this review".
     */
    @Column(length = 64)
    private String tags;

    @Enumerated(EnumType.STRING)
    @Column(name = "suggested_next_action", length = 32)
    private TriageSuggestedAction suggestedNextAction;

    /** All four of RUBRIC v2 §8.6's components in one string: vendor+model, prompt version, schema. */
    @Column(name = "classifier_version", nullable = false, length = 160)
    private String classifierVersion;

    @Column(name = "model_id", nullable = false, length = 80)
    private String modelId;

    /**
     * SHA-256 of the system prompt. The hash and not the text: the prompt lives in the repository
     * under a version, and a copy on every row would be a large duplicate that could still drift
     * from the version string beside it.
     */
    @Column(name = "prompt_hash", nullable = false, length = 64)
    private String promptHash;

    /** This codebase's own phrase ("http 401", "unknown tag"). Never a vendor message. */
    @Column(name = "failure_reason", length = 120)
    private String failureReason;

    @Column(name = "predicted_at", nullable = false)
    private Instant predictedAt;

    public List<String> tagList() {
        return tags == null || tags.isBlank() ? List.of() : List.of(tags.split(","));
    }
}
