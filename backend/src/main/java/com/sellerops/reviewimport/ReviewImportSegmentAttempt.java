package com.sellerops.reviewimport;

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
 * One export+ingest attempt for a {@link ReviewImportSegment}, preserving retry history. Each attempt
 * links its OWN {@link #syncJobId} — a segment never stores a single mutable sync-job pointer, so a retry
 * after a failure keeps the earlier attempt and its job intact. See {@code V27__review_import_plan.sql}.
 */
@Getter
@Setter
@Entity
@Table(name = "review_import_segment_attempt")
public class ReviewImportSegmentAttempt extends BaseEntity {

    @Column(name = "segment_id", nullable = false)
    private UUID segmentId;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** 1-based, per segment. */
    @Column(name = "attempt_no", nullable = false)
    private int attemptNo;

    /** This attempt's ingest run; null until the attempt produces one. */
    @Column(name = "sync_job_id")
    private UUID syncJobId;

    /** The operator confirmed the actual readExportScope matched this segment before exporting. */
    @Column(name = "scope_confirmed", nullable = false)
    private boolean scopeConfirmed = false;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SegmentAttemptResult result = SegmentAttemptResult.ACTIVE;

    @Column(name = "rows_new")
    private Integer rowsNew;

    @Column(name = "rows_duplicate")
    private Integer rowsDuplicate;

    @Column(name = "rows_failed")
    private Integer rowsFailed;

    @Column(name = "error_message", columnDefinition = "text")
    private String errorMessage;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;
}
