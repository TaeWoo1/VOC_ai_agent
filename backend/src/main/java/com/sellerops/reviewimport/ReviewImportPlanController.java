package com.sellerops.reviewimport;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.reviewimport.ReviewImportSegmentPlanner.DateRange;
import com.sellerops.reviewimport.dto.CreateReviewImportPlanRequest;
import com.sellerops.reviewimport.dto.MergeSegmentsRequest;
import com.sellerops.reviewimport.dto.ReviewImportAttemptView;
import com.sellerops.reviewimport.dto.ReviewImportHealthView;
import com.sellerops.reviewimport.dto.ReviewImportPlanDetailView;
import com.sellerops.reviewimport.dto.ReviewImportPlanView;
import com.sellerops.reviewimport.dto.ReviewImportSegmentView;
import com.sellerops.reviewimport.dto.SplitSegmentRequest;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * The NAVER Initial Review Import surface: propose a plan, reshape it (split/merge), import each segment's
 * exported file behind a scope-confirmation gate, conclude unreachable ranges as missing, and read the
 * resumable plan detail + account import-health. Org-scoped from the JWT — {@code orgId} is never a
 * parameter. Sits under the same base as the existing import-history read but on distinct sub-paths.
 */
@RestController
@RequestMapping("/api/imports/reviews")
public class ReviewImportPlanController {

    private final ReviewImportPlanService planService;
    private final ReviewImportRunService runService;
    private final ReviewImportQueryService queryService;

    public ReviewImportPlanController(ReviewImportPlanService planService,
                                      ReviewImportRunService runService,
                                      ReviewImportQueryService queryService) {
        this.planService = planService;
        this.runService = runService;
        this.queryService = queryService;
    }

    @PostMapping("/plans")
    public ReviewImportPlanDetailView createPlan(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @Valid @RequestBody CreateReviewImportPlanRequest req) {
        ReviewImportPlan plan = planService.createPlan(principal.orgId(), req.sellerAccountId(), req.channelId(),
                req.requestedStart(), req.requestedEnd());
        return queryService.planDetail(principal.orgId(), plan.getId());
    }

    @GetMapping("/plans")
    public List<ReviewImportPlanView> listPlans(@AuthenticationPrincipal AuthPrincipal principal,
                                                @RequestParam(required = false) UUID accountId) {
        return planService.listPlans(principal.orgId(), accountId).stream()
                .map(ReviewImportPlanView::from)
                .toList();
    }

    @GetMapping("/plans/{planId}")
    public ReviewImportPlanDetailView getPlan(@AuthenticationPrincipal AuthPrincipal principal,
                                              @PathVariable UUID planId) {
        return queryService.planDetail(principal.orgId(), planId);
    }

    @PostMapping("/plans/{planId}/abandon")
    public ReviewImportPlanView abandon(@AuthenticationPrincipal AuthPrincipal principal,
                                        @PathVariable UUID planId) {
        return ReviewImportPlanView.from(runService.abandonPlan(principal.orgId(), planId));
    }

    @PostMapping("/plans/{planId}/merge")
    public ReviewImportSegmentView merge(@AuthenticationPrincipal AuthPrincipal principal,
                                         @PathVariable UUID planId,
                                         @Valid @RequestBody MergeSegmentsRequest req) {
        return ReviewImportSegmentView.from(planService.mergeSegments(principal.orgId(), req.segmentIds()));
    }

    @PostMapping("/segments/{segmentId}/split")
    public List<ReviewImportSegmentView> split(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable UUID segmentId,
                                               @Valid @RequestBody SplitSegmentRequest req) {
        List<DateRange> children = req.children().stream()
                .map(c -> new DateRange(c.start(), c.end()))
                .toList();
        return planService.splitSegment(principal.orgId(), segmentId, children).stream()
                .map(ReviewImportSegmentView::from)
                .toList();
    }

    @PostMapping("/segments/{segmentId}/missing")
    public ReviewImportSegmentView markMissing(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable UUID segmentId) {
        return ReviewImportSegmentView.from(runService.markMissing(principal.orgId(), segmentId));
    }

    @PostMapping(value = "/segments/{segmentId}/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReviewImportAttemptView importSegment(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @PathVariable UUID segmentId,
                                                 @RequestParam boolean scopeConfirmed,
                                                 @RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("파일이 비어 있습니다.");
        }
        try {
            return ReviewImportAttemptView.from(runService.importSegment(principal.orgId(), segmentId,
                    scopeConfirmed, file.getOriginalFilename(), file.getInputStream()));
        } catch (IOException e) {
            throw ApiException.badRequest("파일을 읽지 못했습니다: " + e.getMessage());
        }
    }

    @GetMapping("/segments/{segmentId}/attempts")
    public List<ReviewImportAttemptView> attempts(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @PathVariable UUID segmentId) {
        return queryService.attemptsOf(principal.orgId(), segmentId);
    }

    @GetMapping("/health")
    public ReviewImportHealthView health(@AuthenticationPrincipal AuthPrincipal principal,
                                         @RequestParam UUID accountId) {
        return queryService.health(principal.orgId(), accountId);
    }
}
