package com.sellerops.itemanalysis;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.itemanalysis.dto.BackfillResult;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.LookupRequest;
import com.sellerops.itemanalysis.dto.ReanalysisResult;
import com.sellerops.itemanalysis.dto.RunResult;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Per-item inbox analysis. Both endpoints require a JWT and are org-scoped via
 * {@code principal.orgId()}. Neither returns or logs raw inquiry/review bodies.
 */
@RestController
@RequestMapping("/api/item-analysis")
public class ItemAnalysisController {

    private final ItemAnalysisService service;

    public ItemAnalysisController(ItemAnalysisService service) {
        this.service = service;
    }

    /** Manual batch: analyze recent un-analyzed items for this org (idempotent). */
    @PostMapping("/run")
    public RunResult run(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.run(principal.orgId());
    }

    /**
     * Bounded, idempotent corpus backfill: analyze up to {@code limit} un-analyzed items
     * (inquiries first) for this org. Re-call until {@code remaining == 0}. Unlike
     * {@code /run}, this is not limited to the 50 most recent items per type.
     */
    @PostMapping("/backfill")
    public BackfillResult backfill(@AuthenticationPrincipal AuthPrincipal principal,
                                   @RequestParam(defaultValue = "500") int limit) {
        return service.backfillMissing(principal.orgId(), limit);
    }

    /**
     * Recompute this org's analyses that a different analyzer version produced — the only way an
     * analyzer change reaches rows that already exist.
     *
     * <p><b>Manual trigger, deliberately.</b> Nothing runs this on deploy: categories drive the
     * review-queue facet counts, so an automatic run would re-bucket an operator's facets
     * mid-session. Re-call until {@code remaining == 0}.
     *
     * <p>{@code dryRun=true} (the DEFAULT) predicts the batch and writes nothing, so the harmless
     * call is the one you get by forgetting the parameter. ⚠ A dry run's {@code remaining} does not
     * count down — never drive a re-call loop on it (see {@code ReanalysisResult}).
     */
    @PostMapping("/reanalyze")
    public ReanalysisResult reanalyze(@AuthenticationPrincipal AuthPrincipal principal,
                                      @RequestParam(defaultValue = "500") int limit,
                                      @RequestParam(defaultValue = "true") boolean dryRun) {
        return dryRun
                ? service.previewReanalysis(principal.orgId(), limit)
                : service.reanalyzeOutdated(principal.orgId(), limit);
    }

    /** Read stored analyses for this org. */
    @GetMapping
    public List<ItemAnalysisView> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.list(principal.orgId());
    }

    /**
     * Inbox-scoped read: analyses for exactly the feed rows the inbox is displaying
     * ({@code {items:[{sourceType,sourceId}]}}). Org-scoped; unknown/foreign ids are ignored.
     * Keeps the inbox off the unbounded {@code GET /api/item-analysis} as the corpus grows.
     */
    @PostMapping("/lookup")
    public List<ItemAnalysisView> lookup(@AuthenticationPrincipal AuthPrincipal principal,
                                         @RequestBody LookupRequest request) {
        return service.lookup(principal.orgId(), request == null ? null : request.items());
    }
}
