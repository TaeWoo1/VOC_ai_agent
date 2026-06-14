package com.sellerops.itemanalysis;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.RunResult;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
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

    /** Read stored analyses for this org. */
    @GetMapping
    public List<ItemAnalysisView> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.list(principal.orgId());
    }
}
