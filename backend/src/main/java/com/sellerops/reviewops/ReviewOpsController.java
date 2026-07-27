package com.sellerops.reviewops;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.reviewops.dto.ReviewOpsLoopSummaryView;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read surface for the repeated review-operations loop. One endpoint, one derived view — the loop's
 * completion result and change summary for a seller account, composed from existing projections. No new
 * durable state; JWT-required and org-scoped like every other controller.
 */
@RestController
@RequestMapping("/api/review-ops")
public class ReviewOpsController {

    private final ReviewOpsLoopSummaryService summaries;

    public ReviewOpsController(ReviewOpsLoopSummaryService summaries) {
        this.summaries = summaries;
    }

    /**
     * The loop's "완료 결과 + 변화 요약" for one seller account. {@code referenceDate} defaults to today
     * (UTC, matching how coverage and review buckets are stored), so the summary is reproducible.
     */
    @GetMapping("/loop-summary")
    public ReviewOpsLoopSummaryView loopSummary(@AuthenticationPrincipal AuthPrincipal principal,
                                                @RequestParam UUID accountId,
                                                @RequestParam(required = false) LocalDate referenceDate) {
        if (accountId == null) {
            throw ApiException.badRequest("요약을 볼 채널 계정을 먼저 선택해 주세요.");
        }
        LocalDate ref = referenceDate == null ? LocalDate.now(ZoneOffset.UTC) : referenceDate;
        return summaries.summary(principal.orgId(), accountId, ref);
    }
}
