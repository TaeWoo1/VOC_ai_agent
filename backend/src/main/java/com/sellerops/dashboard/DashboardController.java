package com.sellerops.dashboard;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.channel.ChannelResponse;
import com.sellerops.channel.ChannelService;
import com.sellerops.channel.OrgChannelVisibility;
import com.sellerops.dashboard.dto.DashboardSummaryResponse;
import com.sellerops.dashboard.dto.OverviewResponse;
import com.sellerops.dashboard.insights.OperationsInsightsService;
import com.sellerops.dashboard.metrics.OperationsMetricsService;
import com.sellerops.dashboard.metrics.dto.OperationsMetricsResponse;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;
    private final ChannelService channelService;
    private final OperationsMetricsService metricsService;
    private final OperationsInsightsService insightsService;
    private final OrgChannelVisibility visibleChannels;

    public DashboardController(DashboardService dashboardService, ChannelService channelService,
                               OperationsMetricsService metricsService,
                               OperationsInsightsService insightsService,
                               OrgChannelVisibility visibleChannels) {
        this.dashboardService = dashboardService;
        this.channelService = channelService;
        this.metricsService = metricsService;
        this.insightsService = insightsService;
        this.visibleChannels = visibleChannels;
    }

    /**
     * The Overview dashboard: KPIs, daily series, channel breakdown, and the insights derived from
     * them. {@code days} defaults to 7 and is bounded by the service.
     */
    @GetMapping("/overview")
    public OverviewResponse overview(@AuthenticationPrincipal AuthPrincipal principal,
                                     @RequestParam(required = false) Integer days) {
        OperationsMetricsResponse metrics =
                // The connectable three PLUS any channel this org actually holds rows on. A manual
                // upload can land on a channel the product cannot connect, and a screen that answers
                // «does this seller have anything» from the connectable list alone cannot see it.
                metricsService.metrics(principal.orgId(), visibleChannels.codesFor(principal.orgId()), days);
        return new OverviewResponse(metrics,
                insightsService.insights(principal.orgId(), metrics,
                        dashboardService.topProductIssues(principal.orgId())));
    }

    @GetMapping("/summary")
    public DashboardSummaryResponse summary(@AuthenticationPrincipal AuthPrincipal principal) {
        return dashboardService.summary(principal.orgId());
    }

    @GetMapping("/channel-status")
    public List<ChannelResponse> channelStatus(@AuthenticationPrincipal AuthPrincipal principal) {
        return channelService.listVisibleForOrg(principal.orgId());
    }
}
