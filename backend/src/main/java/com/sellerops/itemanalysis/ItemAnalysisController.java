package com.sellerops.itemanalysis;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.itemanalysis.dto.BackfillResult;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.RunResult;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
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

    /** Read stored analyses for this org. */
    @GetMapping
    public List<ItemAnalysisView> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.list(principal.orgId());
    }
}
