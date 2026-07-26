package com.sellerops.reviewimport;

import com.sellerops.common.ApiException;
import com.sellerops.reviewimport.dto.DateRangeView;
import com.sellerops.reviewimport.dto.ReviewImportAttemptView;
import com.sellerops.reviewimport.dto.ReviewImportCoverageView;
import com.sellerops.reviewimport.dto.ReviewImportHealthView;
import com.sellerops.reviewimport.dto.ReviewImportPlanDetailView;
import com.sellerops.reviewimport.dto.ReviewImportPlanView;
import com.sellerops.reviewimport.dto.ReviewImportSegmentView;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read side: assembles the resumable plan detail (plan + live segments + coverage) and the account-level
 * import-health surface. Row tallies come from each segment's LATEST attempt, so a retry replaces rather
 * than double-counts. All reads are org-scoped at the boundary.
 */
@Service
public class ReviewImportQueryService {

    private final ReviewImportPlanRepository plans;
    private final ReviewImportSegmentRepository segments;
    private final ReviewImportSegmentAttemptRepository attempts;

    public ReviewImportQueryService(ReviewImportPlanRepository plans,
                                    ReviewImportSegmentRepository segments,
                                    ReviewImportSegmentAttemptRepository attempts) {
        this.plans = plans;
        this.segments = segments;
        this.attempts = attempts;
    }

    @Transactional(readOnly = true)
    public ReviewImportPlanDetailView planDetail(UUID orgId, UUID planId) {
        ReviewImportPlan plan = plans.findByIdAndOrgId(planId, orgId)
                .orElseThrow(() -> ApiException.notFound("가져오기 계획을 찾을 수 없습니다."));
        List<ReviewImportSegment> all = segments.findByPlanIdOrderBySegmentStartAsc(planId);
        List<ReviewImportSegment> live = all.stream().filter(s -> !s.isSuperseded()).toList();
        // The next segment to guide, chosen by the SAME rule the mint uses — so the frontend can display the
        // authoritative choice instead of re-deriving one that might disagree with the ticket.
        UUID nextSegmentId = ReviewImportLaunchService.selectNextRemaining(live)
                .map(ReviewImportSegment::getId)
                .orElse(null);
        return new ReviewImportPlanDetailView(
                ReviewImportPlanView.from(plan),
                all.stream().map(ReviewImportSegmentView::from).toList(),
                ReviewImportCoverageView.from(ReviewImportCoverage.of(live)),
                nextSegmentId);
    }

    @Transactional(readOnly = true)
    public List<ReviewImportAttemptView> attemptsOf(UUID orgId, UUID segmentId) {
        segments.findByIdAndOrgId(segmentId, orgId)
                .orElseThrow(() -> ApiException.notFound("구간을 찾을 수 없습니다."));
        return attempts.findBySegmentIdOrderByAttemptNoAsc(segmentId).stream()
                .map(ReviewImportAttemptView::from)
                .toList();
    }

    /**
     * Account-level import health, aggregated over the live segments of ALL the account's plans: how far
     * coverage reaches, what is still missing, the new/duplicate/failed row tallies (each segment's latest
     * attempt), and the next import to recommend.
     */
    @Transactional(readOnly = true)
    public ReviewImportHealthView health(UUID orgId, UUID sellerAccountId) {
        List<ReviewImportPlan> accountPlans = plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, sellerAccountId);
        List<ReviewImportSegment> live = new ArrayList<>();
        for (ReviewImportPlan p : accountPlans) {
            live.addAll(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(p.getId()));
        }
        ReviewImportCoverage coverage = ReviewImportCoverage.of(live);

        int newCount = 0;
        int duplicateCount = 0;
        int failedCount = 0;
        for (ReviewImportSegment s : live) {
            ReviewImportSegmentAttempt latest = latestAttempt(s.getId());
            if (latest != null) {
                newCount += nz(latest.getRowsNew());
                duplicateCount += nz(latest.getRowsDuplicate());
                failedCount += nz(latest.getRowsFailed());
            }
        }

        LocalDate nextRecommended;
        if (!coverage.remaining().isEmpty()) {
            nextRecommended = coverage.remaining().stream()
                    .map(r -> r.start())
                    .min(Comparator.naturalOrder())
                    .orElse(null);
        } else if (coverage.lastCoveredDate() != null) {
            nextRecommended = coverage.lastCoveredDate().plusDays(1);
        } else {
            nextRecommended = null;
        }

        return new ReviewImportHealthView(
                coverage.lastCoveredDate(),
                coverage.missing().stream().map(DateRangeView::from).toList(),
                newCount, duplicateCount, failedCount, nextRecommended);
    }

    private ReviewImportSegmentAttempt latestAttempt(UUID segmentId) {
        List<ReviewImportSegmentAttempt> list = attempts.findBySegmentIdOrderByAttemptNoAsc(segmentId);
        return list.isEmpty() ? null : list.get(list.size() - 1);
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }
}
