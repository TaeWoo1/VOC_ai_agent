package com.sellerops.dashboard;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.channel.ChannelResponse;
import com.sellerops.channel.ChannelService;
import com.sellerops.dashboard.dto.DashboardSummaryResponse;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;
    private final ChannelService channelService;

    public DashboardController(DashboardService dashboardService, ChannelService channelService) {
        this.dashboardService = dashboardService;
        this.channelService = channelService;
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
