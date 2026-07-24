package com.sellerops.reviewimport;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One bounded export window within a {@link ReviewImportPlan} (V1 default: one calendar month). Carries
 * the two orthogonal state axes in separate columns — {@link SegmentExecutionState execution} and
 * {@link SegmentCoverageState coverage} — never conflated. A split replaces a segment with shorter child
 * ranges (see {@link #parentSegmentId}); the parent is {@link #superseded} and leaves the coverage rollup
 * while staying reachable. See {@code V27__review_import_plan.sql}.
 */
@Getter
@Setter
@Entity
@Table(name = "review_import_segment")
public class ReviewImportSegment extends BaseEntity {

    @Column(name = "plan_id", nullable = false)
    private UUID planId;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** Set on the children of a split; null for an original (un-split) segment. */
    @Column(name = "parent_segment_id")
    private UUID parentSegmentId;

    @Column(nullable = false)
    private int ordinal;

    @Column(name = "segment_start", nullable = false)
    private LocalDate segmentStart;

    /** Inclusive. */
    @Column(name = "segment_end", nullable = false)
    private LocalDate segmentEnd;

    @Enumerated(EnumType.STRING)
    @Column(name = "execution_state", nullable = false)
    private SegmentExecutionState executionState = SegmentExecutionState.PENDING;

    @Enumerated(EnumType.STRING)
    @Column(name = "coverage_state", nullable = false)
    private SegmentCoverageState coverageState = SegmentCoverageState.UNVERIFIED;

    /** Row total the covering export brought (0 = a valid empty). Null until covered. */
    @Column(name = "covered_rows")
    private Integer coveredRows;

    /**
     * Honest completeness flag. With NAVER's per-export row cap UNKNOWN we cannot prove every expected row
     * arrived, so a covered segment stays {@code false}: "scope exported successfully" is not "all expected
     * rows reconciled". Only set true if a source of truth for the expected count is ever established.
     */
    @Column(name = "rows_reconciled", nullable = false)
    private boolean rowsReconciled = false;

    /** True once this segment has been replaced by split children; it drops out of the coverage rollup. */
    @Column(nullable = false)
    private boolean superseded = false;
}
