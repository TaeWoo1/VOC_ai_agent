package com.sellerops.reviewimport;

import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.common.ApiException;
import com.sellerops.connector.FileUploadConnector;
import com.sellerops.ingest.IngestResult;
import com.sellerops.ingest.UploadType;
import java.io.InputStream;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Runs one segment's export through the EXISTING upload/ingest path and records the attempt. Reuses
 * {@link FileUploadConnector} unchanged (parse → map → dedup-safe ingest → sync_job), so overlap-safe
 * dedup (on {@code external_id} = 리뷰글번호) and reply-state/timestamp preservation carry over exactly.
 *
 * <p>Each call is one attempt: it links its own sync_job, so retry history is preserved. The
 * scope-confirmation gate is enforced here — the operator must have confirmed the actual readExportScope
 * matched this segment before the file is accepted (the per-segment equivalent of the export-scope gate).
 *
 * <p>Execution vs coverage stay separate: a hard ingest failure marks the attempt and the segment
 * {@link SegmentExecutionState#FAILED} with coverage untouched; a success (a valid EMPTY included) marks
 * {@link SegmentExecutionState#COMPLETED} + {@link SegmentCoverageState#COVERED}. {@code coveredRows} is
 * new + duplicate (rows now accounted for); {@code rowsReconciled} stays false — "scope exported
 * successfully" is not "all expected rows reconciled" while the row cap is unknown.
 */
@Service
public class ReviewImportRunService {

    private final ReviewImportPlanRepository plans;
    private final ReviewImportSegmentRepository segments;
    private final ReviewImportSegmentAttemptRepository attempts;
    private final FileUploadConnector uploadConnector;
    private final ReviewImportPlanService planService;

    public ReviewImportRunService(ReviewImportPlanRepository plans,
                                  ReviewImportSegmentRepository segments,
                                  ReviewImportSegmentAttemptRepository attempts,
                                  FileUploadConnector uploadConnector,
                                  ReviewImportPlanService planService) {
        this.plans = plans;
        this.segments = segments;
        this.attempts = attempts;
        this.uploadConnector = uploadConnector;
        this.planService = planService;
    }

    /**
     * Import one segment's exported file. {@code scopeConfirmed} MUST be true — the operator confirmed the
     * actual export scope matched this segment. Returns the recorded attempt (SUCCEEDED or FAILED); a
     * FAILED attempt is a normal outcome the operator can retry, not an API error.
     */
    @Transactional
    public ReviewImportSegmentAttempt importSegment(UUID orgId, UUID segmentId, boolean scopeConfirmed,
                                                    String filename, InputStream data) {
        ReviewImportSegment segment = segments.findByIdAndOrgId(segmentId, orgId)
                .orElseThrow(() -> ApiException.notFound("구간을 찾을 수 없습니다."));
        if (segment.isSuperseded()) {
            throw ApiException.conflict("분할되어 대체된 구간에는 가져오기를 실행할 수 없습니다.");
        }
        if (segment.getExecutionState() == SegmentExecutionState.ACTIVE) {
            throw ApiException.conflict("이미 진행 중인 구간입니다.");
        }
        if (!scopeConfirmed) {
            throw ApiException.badRequest("내보내기 범위가 이 구간과 일치하는지 먼저 확인해 주세요.");
        }
        ReviewImportPlan plan = plans.findById(segment.getPlanId())
                .orElseThrow(() -> ApiException.notFound("가져오기 계획을 찾을 수 없습니다."));

        ReviewImportSegmentAttempt attempt = new ReviewImportSegmentAttempt();
        attempt.setSegmentId(segmentId);
        attempt.setOrgId(orgId);
        attempt.setAttemptNo(attempts.nextAttemptNo(segmentId));
        attempt.setScopeConfirmed(true);
        attempt.setResult(SegmentAttemptResult.ACTIVE);
        attempt.setStartedAt(Instant.now());
        attempt = attempts.save(attempt);

        segment.setExecutionState(SegmentExecutionState.ACTIVE);
        segments.save(segment);

        IngestResult result = uploadConnector.ingest(orgId, plan.getChannelId(), UploadType.REVIEW,
                filename, data, CollectionMethod.SELLER_CENTER_EXPORT);

        attempt.setSyncJobId(result.syncJobId());
        attempt.setRowsNew(result.successRows());
        attempt.setRowsDuplicate(result.skippedRows());
        attempt.setRowsFailed(result.failedRows());
        attempt.setFinishedAt(Instant.now());

        if ("FAILED".equals(result.status())) {
            attempt.setResult(SegmentAttemptResult.FAILED);
            attempt.setErrorMessage(result.errorMessage());
            segment.setExecutionState(SegmentExecutionState.FAILED);
            // coverage stays UNVERIFIED — a failed attempt is not a coverage conclusion.
        } else {
            attempt.setResult(SegmentAttemptResult.SUCCEEDED);
            segment.setExecutionState(SegmentExecutionState.COMPLETED);
            segment.setCoverageState(SegmentCoverageState.COVERED); // a valid empty (0 rows) is still COVERED
            segment.setCoveredRows(result.successRows() + result.skippedRows());
        }
        attempts.save(attempt);
        segments.save(segment);
        planService.recomputePlanStatus(plan.getId());
        return attempt;
    }

    /**
     * Conclude that a segment's range cannot be covered (earlier than the earliest date NAVER lets the
     * seller select, per the live UI). Coverage → MISSING and execution → COMPLETED: this is a terminal
     * operator CONCLUSION (no more attempts), not a failed attempt, and it reads to the seller as
     * "가져올 수 없는 기간". The segment stays reachable and its attempt history (if any) is preserved.
     */
    @Transactional
    public ReviewImportSegment markMissing(UUID orgId, UUID segmentId) {
        ReviewImportSegment segment = segments.findByIdAndOrgId(segmentId, orgId)
                .orElseThrow(() -> ApiException.notFound("구간을 찾을 수 없습니다."));
        if (segment.isSuperseded()) {
            throw ApiException.conflict("분할되어 대체된 구간입니다.");
        }
        segment.setCoverageState(SegmentCoverageState.MISSING);
        segment.setExecutionState(SegmentExecutionState.COMPLETED);
        segments.save(segment);
        planService.recomputePlanStatus(segment.getPlanId());
        return segment;
    }

    /** End a plan with remaining work; it stays reachable. */
    @Transactional
    public ReviewImportPlan abandonPlan(UUID orgId, UUID planId) {
        ReviewImportPlan plan = plans.findByIdAndOrgId(planId, orgId)
                .orElseThrow(() -> ApiException.notFound("가져오기 계획을 찾을 수 없습니다."));
        plan.setStatus(ReviewImportPlanStatus.ABANDONED);
        return plans.save(plan);
    }
}
