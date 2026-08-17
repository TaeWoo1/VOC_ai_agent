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
 * One trace of what the operator did on the way. Silver — see {@link TriageBehaviorKind}.
 *
 * <p><b>The weight is not a column.</b> It is a policy applied when a silver snapshot is cut, so it
 * can be revised without rewriting history and so no consumer can read a weight without also
 * reading the policy that produced it (feedback draft §7.1).
 */
@Getter
@Setter
@Entity
@Table(name = "review_triage_behavior_events")
public class TriageBehaviorEvent extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "prediction_id")
    private UUID predictionId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private TriageBehaviorKind kind;

    @Enumerated(EnumType.STRING)
    @Column(name = "shown_tier", length = 24)
    private ReviewTriageTier shownTier;

    @Enumerated(EnumType.STRING)
    @Column(name = "shown_source", length = 8)
    private TriageShownSource shownSource;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @Column(name = "snapshot_version", length = 40)
    private String snapshotVersion;
}
