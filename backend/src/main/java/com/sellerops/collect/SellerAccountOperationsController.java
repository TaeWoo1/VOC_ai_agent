package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.AccountDashboardSummary;
import com.sellerops.collect.dto.ArticleListResponse;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operator read views for one connected account — dashboard summary and the
 * collected-article drill-down. Thin delegate over {@link ChannelOperationsService};
 * orgId always comes from the authenticated principal, never the client.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}")
public class SellerAccountOperationsController {

    private final ChannelOperationsService service;

    public SellerAccountOperationsController(ChannelOperationsService service) {
        this.service = service;
    }

    /** Dashboard summary over an explicit [from, to] window (KST calendar dates). */
    @GetMapping("/dashboard")
    public AccountDashboardSummary dashboard(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.accountDashboard(principal.orgId(), accountId, from, to);
    }

    /** Paginated drill-down of collected articles for one type (REVIEW / INQUIRY). */
    @GetMapping("/articles")
    public ArticleListResponse articles(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @RequestParam String type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return service.accountArticles(principal.orgId(), accountId, type, page, size);
    }
}
