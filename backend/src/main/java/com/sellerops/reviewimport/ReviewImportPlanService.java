package com.sellerops.reviewimport;

import com.sellerops.common.ApiException;
import com.sellerops.reviewimport.ReviewImportSegmentPlanner.DateRange;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Plans a historical review import and lets the operator adjust its shape. Structure only — generating the
 * monthly segments and reshaping them by split/merge. It does NOT run exports or ingest: an attempt's
 * lifecycle lives in the run service (added next). All reads/writes are org-scoped at the boundary.
 *
 * <p>The plan is created from the REQUESTED period verbatim (decision, 2026-07-24: no SellerOps depth
 * limit — the earliest reachable date is discovered per-segment from the live export UI, and any
 * earlier-than-reachable range surfaces later as {@link SegmentCoverageState#MISSING}). V1 segmentation is
 * fixed calendar months ({@link ReviewImportSegmentPlanner}); the operator may split a segment into shorter
 * child ranges (e.g. after a failure or a suspected truncation) or merge adjacent not-yet-run segments.
 */
@Service
public class ReviewImportPlanService {

    private final ReviewImportPlanRepository plans;
    private final ReviewImportSegmentRepository segments;

    public ReviewImportPlanService(ReviewImportPlanRepository plans, ReviewImportSegmentRepository segments) {
        this.plans = plans;
        this.segments = segments;
    }

    /** Create a plan over [requestedStart, requestedEnd] and persist its calendar-month segments (PENDING). */
    @Transactional
    public ReviewImportPlan createPlan(UUID orgId, UUID sellerAccountId, UUID channelId,
                                       LocalDate requestedStart, LocalDate requestedEnd) {
        if (sellerAccountId == null || channelId == null) {
            throw ApiException.badRequest("가져오기를 진행할 채널 계정을 먼저 선택해 주세요.");
        }
        List<DateRange> ranges = ReviewImportSegmentPlanner.monthlySegments(requestedStart, requestedEnd);

        ReviewImportPlan plan = new ReviewImportPlan();
        plan.setOrgId(orgId);
        plan.setSellerAccountId(sellerAccountId);
        plan.setChannelId(channelId);
        plan.setRequestedStart(requestedStart);
        plan.setRequestedEnd(requestedEnd);
        plan.setStatus(ReviewImportPlanStatus.DRAFT);
        plan = plans.save(plan);

        int ordinal = 0;
        for (DateRange r : ranges) {
            segments.save(newSegment(plan.getId(), orgId, null, ordinal++, r.start(), r.end()));
        }
        return plan;
    }

    @Transactional(readOnly = true)
    public ReviewImportPlan getPlan(UUID orgId, UUID planId) {
        return plans.findByIdAndOrgId(planId, orgId)
                .orElseThrow(() -> ApiException.notFound("가져오기 계획을 찾을 수 없습니다."));
    }

    @Transactional(readOnly = true)
    public List<ReviewImportSegment> segmentsOf(UUID orgId, UUID planId) {
        getPlan(orgId, planId); // authorize
        return segments.findByPlanIdOrderBySegmentStartAsc(planId);
    }

    @Transactional(readOnly = true)
    public List<ReviewImportPlan> listPlans(UUID orgId, UUID sellerAccountId) {
        return sellerAccountId == null
                ? plans.findByOrgIdOrderByCreatedAtDesc(orgId)
                : plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, sellerAccountId);
    }

    /**
     * Split one segment into contiguous shorter child ranges that EXACTLY tile the parent (no gap, no
     * overlap, ≥2 children). The parent is superseded (kept for history) and the children start PENDING.
     * Allowed on any non-superseded segment — including a FAILED or a suspected-truncated COMPLETED one —
     * so the operator can recover coverage at finer granularity; dedup makes the re-export overlap-safe.
     */
    @Transactional
    public List<ReviewImportSegment> splitSegment(UUID orgId, UUID segmentId, List<DateRange> children) {
        ReviewImportSegment parent = requireSegment(orgId, segmentId);
        if (parent.isSuperseded()) {
            throw ApiException.conflict("이미 분할된 구간은 다시 분할할 수 없습니다.");
        }
        if (children == null || children.size() < 2) {
            throw ApiException.badRequest("구간을 나누려면 두 개 이상의 하위 구간이 필요합니다.");
        }
        List<DateRange> sorted = children.stream().sorted((a, b) -> a.start().compareTo(b.start())).toList();
        if (!sorted.get(0).start().equals(parent.getSegmentStart())
                || !sorted.get(sorted.size() - 1).end().equals(parent.getSegmentEnd())) {
            throw ApiException.badRequest("하위 구간은 원래 구간의 시작일과 종료일을 그대로 덮어야 합니다.");
        }
        for (int i = 1; i < sorted.size(); i++) {
            if (!sorted.get(i).start().equals(sorted.get(i - 1).end().plusDays(1))) {
                throw ApiException.badRequest("하위 구간은 빈틈이나 겹침 없이 이어져야 합니다.");
            }
        }

        parent.setSuperseded(true);
        segments.save(parent);
        List<ReviewImportSegment> created = new java.util.ArrayList<>();
        for (DateRange r : sorted) {
            created.add(segments.save(
                    newSegment(parent.getPlanId(), orgId, parent.getId(), parent.getOrdinal(), r.start(), r.end())));
        }
        recomputePlanStatus(parent.getPlanId());
        return created;
    }

    /**
     * Merge adjacent, not-yet-run (PENDING) segments of one plan into a single segment spanning their
     * whole range. Restricted to PENDING so a merge never discards a run attempt or covered data — to
     * reshape after a run, split instead. The originals are superseded (kept for history).
     */
    @Transactional
    public ReviewImportSegment mergeSegments(UUID orgId, List<UUID> segmentIds) {
        if (segmentIds == null || segmentIds.size() < 2) {
            throw ApiException.badRequest("합치려면 두 개 이상의 구간을 선택해 주세요.");
        }
        List<ReviewImportSegment> selected = segmentIds.stream()
                .distinct()
                .map(id -> requireSegment(orgId, id))
                .sorted((a, b) -> a.getSegmentStart().compareTo(b.getSegmentStart()))
                .toList();

        UUID planId = selected.get(0).getPlanId();
        for (ReviewImportSegment s : selected) {
            if (!s.getPlanId().equals(planId)) {
                throw ApiException.badRequest("같은 계획 안의 구간만 합칠 수 있습니다.");
            }
            if (s.isSuperseded() || s.getExecutionState() != SegmentExecutionState.PENDING) {
                throw ApiException.conflict("아직 실행하지 않은 구간만 합칠 수 있습니다.");
            }
        }
        for (int i = 1; i < selected.size(); i++) {
            if (!selected.get(i).getSegmentStart().equals(selected.get(i - 1).getSegmentEnd().plusDays(1))) {
                throw ApiException.badRequest("이어져 있는 구간만 합칠 수 있습니다.");
            }
        }

        ReviewImportSegment merged = newSegment(planId, orgId, null,
                selected.get(0).getOrdinal(),
                selected.get(0).getSegmentStart(),
                selected.get(selected.size() - 1).getSegmentEnd());
        merged = segments.save(merged);
        for (ReviewImportSegment s : selected) {
            s.setSuperseded(true);
            segments.save(s);
        }
        recomputePlanStatus(planId);
        return merged;
    }

    /**
     * Extend a plan FORWARD to {@code today}: materialize new PENDING calendar-month segments covering the
     * span AFTER the plan's current latest live segment, up to today. This is the repeated review-operations
     * loop's incremental step — a plan created weeks ago over [start, then] is carried forward to cover the
     * reviews that have arrived since, WITHOUT creating a second plan (a second plan is refused while one is
     * live; extending the same plan is the sanctioned way to continue). Idempotent: if the plan already
     * reaches today, nothing is added and the plan is returned unchanged.
     *
     * <p>Structure only, like {@link #createPlan}: it appends PENDING segments and bumps {@code requestedEnd}
     * to today; it runs no export and ingests nothing. A COMPLETED plan that gains new PENDING segments
     * recomputes back to ACTIVE — that reopening IS the loop. Overlap-safe dedup means even if the newest
     * existing segment's month is re-run, no row is double-counted, so the forward edge never needs to be
     * pixel-perfect. Fails closed on a MISSING-only tail the same as elsewhere: a concluded MISSING segment
     * does not block the forward edge because the new span starts after the latest segment end.
     */
    @Transactional
    public List<ReviewImportSegment> extendPlanForward(UUID orgId, UUID planId, LocalDate today) {
        ReviewImportPlan plan = getPlan(orgId, planId); // authorize
        if (plan.getStatus() == ReviewImportPlanStatus.ABANDONED) {
            throw ApiException.conflict("종료된 가져오기 계획은 이어서 확장할 수 없습니다.");
        }
        if (today == null) {
            throw ApiException.badRequest("확장 기준 날짜가 필요합니다.");
        }
        List<ReviewImportSegment> live = segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId);
        LocalDate latestEnd = live.stream()
                .map(ReviewImportSegment::getSegmentEnd)
                .reduce((a, b) -> b.isAfter(a) ? b : a)
                .orElse(plan.getRequestedEnd());
        LocalDate newStart = latestEnd.plusDays(1);
        if (newStart.isAfter(today)) {
            return List.of(); // already carried forward to today — idempotent no-op
        }
        int ordinal = live.stream().mapToInt(ReviewImportSegment::getOrdinal).max().orElse(-1) + 1;
        List<ReviewImportSegment> created = new java.util.ArrayList<>();
        for (DateRange r : ReviewImportSegmentPlanner.monthlySegments(newStart, today)) {
            created.add(segments.save(newSegment(planId, orgId, null, ordinal++, r.start(), r.end())));
        }
        plan.setRequestedEnd(today);
        plans.save(plan);
        recomputePlanStatus(planId);
        return created;
    }

    /**
     * Recompute the plan's derived status from its live (non-superseded) segments: DRAFT if none has been
     * attempted, COMPLETED if none remains (each COMPLETED or concluded MISSING), else ACTIVE. Never
     * downgrades an ABANDONED plan — that is an operator terminal state.
     */
    @Transactional
    public void recomputePlanStatus(UUID planId) {
        ReviewImportPlan plan = plans.findById(planId).orElse(null);
        if (plan == null || plan.getStatus() == ReviewImportPlanStatus.ABANDONED) {
            return;
        }
        List<ReviewImportSegment> live = segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId);
        boolean anyAttempted = live.stream().anyMatch(s -> s.getExecutionState() != SegmentExecutionState.PENDING);
        boolean anyRemaining = live.stream()
                .anyMatch(s -> s.getExecutionState().isRemaining() && s.getCoverageState() != SegmentCoverageState.MISSING);
        plan.setStatus(!anyAttempted ? ReviewImportPlanStatus.DRAFT
                : anyRemaining ? ReviewImportPlanStatus.ACTIVE
                : ReviewImportPlanStatus.COMPLETED);
        plans.save(plan);
    }

    private ReviewImportSegment requireSegment(UUID orgId, UUID segmentId) {
        return segments.findByIdAndOrgId(segmentId, orgId)
                .orElseThrow(() -> ApiException.notFound("구간을 찾을 수 없습니다."));
    }

    private static ReviewImportSegment newSegment(UUID planId, UUID orgId, UUID parentId, int ordinal,
                                                  LocalDate start, LocalDate end) {
        ReviewImportSegment s = new ReviewImportSegment();
        s.setPlanId(planId);
        s.setOrgId(orgId);
        s.setParentSegmentId(parentId);
        s.setOrdinal(ordinal);
        s.setSegmentStart(start);
        s.setSegmentEnd(end);
        s.setExecutionState(SegmentExecutionState.PENDING);
        s.setCoverageState(SegmentCoverageState.UNVERIFIED);
        return s;
    }
}
