package com.sellerops.reviewimport;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.reviewimport.ReviewImportSegmentPlanner.DateRange;
import com.sellerops.reviewimport.dto.CreateReviewImportPlanRequest;
import com.sellerops.reviewimport.dto.MergeSegmentsRequest;
import com.sellerops.reviewimport.dto.RecordDiscoveredRangeRequest;
import com.sellerops.reviewimport.dto.ReviewImportAttemptView;
import com.sellerops.reviewimport.dto.ReviewImportHealthView;
import com.sellerops.reviewimport.dto.ReviewImportLaunchScopeView;
import com.sellerops.reviewimport.dto.ReviewImportLaunchView;
import com.sellerops.reviewimport.dto.ReviewImportPlanDetailView;
import com.sellerops.reviewimport.dto.ReviewImportPlanView;
import com.sellerops.reviewimport.dto.ReviewImportRangeSelectionView;
import com.sellerops.reviewimport.dto.ReviewImportSegmentView;
import com.sellerops.reviewimport.dto.SelectImportRangeRequest;
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
 * The NAVER Initial Review Import surface. Two ways in, deliberately unequal:
 *
 * <ul>
 *   <li><b>The product path</b> — {@code /plans/range-preview} → {@code /plans/selected-range} → {@code
 *       /launches/*}. The seller picks how far back to import and confirms the period and the number of monthly
 *       exports it becomes; each segment is then a single-use ticket authorizing one guided Action Window run,
 *       whose download is detected and ingested automatically.</li>
 *   <li><b>The fallback</b> — {@code /segments/{id}/import} plus the explicit {@code /plans} creation.
 *       Kept because a guided run can be unavailable (no local agent), but it asks the seller to find and
 *       upload a file themselves, so it is not the default experience.</li>
 * </ul>
 *
 * Plus the shared surface both use: reshape a plan (split/merge), conclude unreachable ranges as missing,
 * and read the resumable plan detail + account import-health. Org-scoped from the JWT — {@code orgId} is
 * never a parameter. Sits under the same base as the existing import-history read but on distinct sub-paths.
 */
@RestController
@RequestMapping("/api/imports/reviews")
public class ReviewImportPlanController {

    private final ReviewImportPlanService planService;
    private final ReviewImportRunService runService;
    private final ReviewImportQueryService queryService;
    private final ReviewImportLaunchService launchService;

    public ReviewImportPlanController(ReviewImportPlanService planService,
                                      ReviewImportRunService runService,
                                      ReviewImportQueryService queryService,
                                      ReviewImportLaunchService launchService) {
        this.planService = planService;
        this.runService = runService;
        this.queryService = queryService;
        this.launchService = launchService;
    }

    /* ─────────────── The product path: the seller's choice, then guided runs ─────────────── */

    /**
     * What starting from {@code startMonth} would create — the period and how many monthly exports it becomes.
     *
     * Read-only and creates nothing: this is the screen the seller confirms on, and the count is the fact that
     * makes their choice a decision rather than a date entry.
     */
    @GetMapping("/plans/range-preview")
    public ReviewImportRangeSelectionView previewRange(@AuthenticationPrincipal AuthPrincipal principal,
                                                       @RequestParam UUID accountId,
                                                       @RequestParam String startMonth) {
        return ReviewImportRangeSelectionView.from(
                launchService.previewSelection(principal.orgId(), accountId, startMonth));
    }

    /**
     * "과거 리뷰 전체 연동하기" — create the plan the seller chose: their start month through today, one segment
     * per calendar month.
     *
     * This replaced a guided range-DISCOVERY run (2026-07-26). That run drove the seller through NAVER's date
     * pickers to find how far back the marketplace would let them reach; the 2026-07-25 live run established
     * that it restricts nothing, so the question was about a limit that does not exist. How much history to
     * import is the seller's decision, and it needs no marketplace window at all.
     */
    @PostMapping("/plans/selected-range")
    public ReviewImportPlanDetailView selectRange(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @Valid @RequestBody SelectImportRangeRequest req) {
        ReviewImportPlan plan = launchService.recordSelectedRange(principal.orgId(), req.sellerAccountId(),
                req.startMonth());
        return queryService.planDetail(principal.orgId(), plan.getId());
    }

    /**
     * Authorize a plan creation for a connected account without performing it.
     *
     * Retained for the ticket's own sake: it is the single-use authorization that makes plan creation
     * idempotent per account. {@link #selectRange} mints and spends one in a single call, so a caller
     * normally never needs this.
     */
    @PostMapping("/launches/discovery")
    public ReviewImportLaunchView startDiscovery(@AuthenticationPrincipal AuthPrincipal principal,
                                                @RequestParam UUID accountId) {
        return launchView(launchService.mintDiscovery(principal.orgId(), accountId));
    }

    /**
     * Resolve a launch ref to the scope the RUNTIME may know: the channel to open and, for a segment run,
     * the dates to guide the seller to. Carries no plan/segment/account identity.
     */
    @GetMapping("/launches/{launchRef}/scope")
    public ReviewImportLaunchScopeView launchScope(@AuthenticationPrincipal AuthPrincipal principal,
                                                   @PathVariable String launchRef) {
        return ReviewImportLaunchScopeView.from(launchService.resolveScope(principal.orgId(), launchRef));
    }

    /**
     * Record what discovery found and create the plan + monthly segments over that range. Spends the
     * discovery ticket; the response is the plan the seller will now work through.
     */
    @PostMapping("/launches/{launchRef}/discovered-range")
    public ReviewImportPlanDetailView recordDiscoveredRange(@AuthenticationPrincipal AuthPrincipal principal,
                                                            @PathVariable String launchRef,
                                                            @Valid @RequestBody RecordDiscoveredRangeRequest req) {
        RangeDiscoveryEvidence evidence = parseEnum(RangeDiscoveryEvidence.class, req.evidence(),
                "기간을 어떻게 확인했는지 알 수 없습니다.");
        ReviewImportPlan plan = launchService.recordDiscoveredRange(principal.orgId(), launchRef,
                req.availableStart(), req.availableEnd(), evidence);
        return queryService.planDetail(principal.orgId(), plan.getId());
    }

    /** "계속 가져오기" — authorize a run for the next segment that still needs one. */
    @PostMapping("/plans/{planId}/launches/next-segment")
    public ReviewImportLaunchView launchNextSegment(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable UUID planId) {
        return launchView(launchService.mintNextSegment(principal.orgId(), planId));
    }

    /** Authorize a run for one specific segment — also the retry path after a failure. */
    @PostMapping("/segments/{segmentId}/launch")
    public ReviewImportLaunchView launchSegment(@AuthenticationPrincipal AuthPrincipal principal,
                                                @PathVariable UUID segmentId) {
        return launchView(launchService.mintSegment(principal.orgId(), segmentId));
    }

    /**
     * Ingest the file a guided run downloaded, into the segment its ticket is bound to. This is the
     * automatic path — the seller never locates or uploads the file. {@code scopeEvidence} states how the
     * exported scope was established (MACHINE_MATCHED | OPERATOR_CONFIRMED).
     */
    @PostMapping(value = "/launches/{launchRef}/ingest", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReviewImportAttemptView ingestForLaunch(@AuthenticationPrincipal AuthPrincipal principal,
                                                   @PathVariable String launchRef,
                                                   @RequestParam String scopeEvidence,
                                                   @RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("파일이 비어 있습니다.");
        }
        ScopeEvidence evidence = parseEnum(ScopeEvidence.class, scopeEvidence,
                "내보내기 범위를 어떻게 확인했는지 알 수 없습니다.");
        try {
            return ReviewImportAttemptView.from(launchService.ingestForLaunch(principal.orgId(), launchRef,
                    evidence, file.getOriginalFilename(), file.getInputStream()));
        } catch (IOException e) {
            throw ApiException.badRequest("파일을 읽지 못했습니다: " + e.getMessage());
        }
    }

    /** Give up an outstanding authorization (window closed, or starting over) without spending it. */
    @PostMapping("/launches/{launchRef}/expire")
    public ReviewImportLaunchView expireLaunch(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable String launchRef) {
        return launchView(launchService.expire(principal.orgId(), launchRef));
    }

    private ReviewImportLaunchView launchView(ReviewImportLaunch ticket) {
        DateRange required = launchService.requiredDatesOf(ticket);
        return ReviewImportLaunchView.from(ticket,
                required == null ? null : required.start(),
                required == null ? null : required.end());
    }

    /** Fail closed on an unrecognised enum: an unknown evidence value must never be coerced to a known one. */
    private static <E extends Enum<E>> E parseEnum(Class<E> type, String raw, String message) {
        try {
            return Enum.valueOf(type, raw == null ? "" : raw.trim());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest(message);
        }
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
