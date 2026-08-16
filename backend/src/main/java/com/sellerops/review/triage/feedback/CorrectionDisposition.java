package com.sellerops.review.triage.feedback;

import com.sellerops.common.BaseEntity;
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
 * A human's reading of one correction: classifier error, or seller preference.
 *
 * <p>Named {@code CorrectionDisposition} in this package alongside
 * {@code com.sellerops.attention.triage.CorrectionDisposition}, which is a different thing about a
 * different subject — that one records what an operator concluded about a REVIEW. This one records
 * what a reviewer concluded about a CORRECTION. They are never read together and neither imports
 * the other.
 */
@Getter
@Setter
@Entity
@Table(name = "review_correction_dispositions")
public class CorrectionDisposition extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "correction_id", nullable = false)
    private UUID correctionId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private CorrectionDispositionKind disposition;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "decided_at", nullable = false)
    private Instant decidedAt;

    /**
     * Which frozen snapshot this was folded into, or null while it is still loose.
     *
     * <p>A snapshot is cut, numbered and never reopened. An evaluation set that changes under a
     * metric makes the metric meaningless, which is the same reason RUBRIC §4's sample is
     * pre-committed.
     */
    @Column(name = "snapshot_version", length = 40)
    private String snapshotVersion;
}
