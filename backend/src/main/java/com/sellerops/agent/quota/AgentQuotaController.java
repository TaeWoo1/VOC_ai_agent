package com.sellerops.agent.quota;

import com.sellerops.auth.AuthPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * READ: how much of today's Agent budget this org has spent.
 *
 * <p>Visible on purpose. A ceiling nobody can see is a ceiling that is only ever discovered by
 * hitting it, and the seller's first experience of it would be a refusal with no context.
 */
@RestController
@RequestMapping("/api/agent/quota")
public class AgentQuotaController {

    private final AgentQuotaService quota;

    public AgentQuotaController(AgentQuotaService quota) {
        this.quota = quota;
    }

    @GetMapping
    public AgentQuotaService.AgentQuotaStatus status(@AuthenticationPrincipal AuthPrincipal principal) {
        return quota.status(principal.orgId());
    }
}
