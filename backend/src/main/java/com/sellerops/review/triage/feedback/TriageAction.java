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
 * One explicit act on a review: started, completed, or declared not needed.
 *
 * <p>Append-only. A seller who starts and later completes has two rows, and the pair is the record.
 * Nothing here is content, and nothing here changes a running classifier — it accumulates into a
 * numbered snapshot ({@link #snapshotVersion}) that a NEXT version is measured against, offline.
 */
@Getter
@Setter
@Entity
@Table(name = "review_triage_actions")
public class TriageAction extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "prediction_id")
    private UUID predictionId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TriageActionKind kind;

    @Enumerated(EnumType.STRING)
    @Column(name = "shown_tier", length = 24)
    private ReviewTriageTier shownTier;

    @Enumerated(EnumType.STRING)
    @Column(name = "shown_source", length = 8)
    private TriageShownSource shownSource;

    @Column(name = "actor_id")
    private UUID actorId;

    @Column(name = "acted_at", nullable = false)
    private Instant actedAt;

    @Column(name = "snapshot_version", length = 40)
    private String snapshotVersion;
}
