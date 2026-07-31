package com.sellerops.connector.cafe24.onboarding;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.connector.cafe24.Cafe24ConnectionCapabilityService;
import com.sellerops.connector.cafe24.capability.Cafe24ConnectionCapabilityView;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The first-connection tutorial's verification surface: a read-only capability check for one
 * connected Cafe24 account. Org-scoped via {@code principal.orgId()} — a foreign/unknown
 * account id is a 404.
 *
 * <p>Behind the same {@code sellerops.connector.cafe24.enabled} flag as the connect controller,
 * because the check reuses the flag-gated Cafe24 authorize + board-discovery beans. With the flag
 * off the endpoint (and those beans) do not exist, and the tutorial treats the absence as
 * "verification unavailable" rather than success.
 *
 * <p><b>POST, not GET:</b> the check performs a live token refresh with single-use rotation, so it
 * has a real side effect and must not be a cacheable/prefetchable GET. It never sends to the
 * marketplace and never writes application data beyond the credential rotation the connector
 * already performs on every authorized call.
 */
@RestController
@RequestMapping("/api/connect/cafe24/{accountId}")
@ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
public class Cafe24ConnectionCapabilityController {

    private final Cafe24ConnectionCapabilityService service;

    public Cafe24ConnectionCapabilityController(Cafe24ConnectionCapabilityService service) {
        this.service = service;
    }

    /** Read-only capability check + per-feature status for the tutorial's verify/complete screens. */
    @PostMapping("/capability")
    public Cafe24ConnectionCapabilityView capability(@AuthenticationPrincipal AuthPrincipal principal,
                                                     @PathVariable UUID accountId) {
        return service.check(principal.orgId(), accountId);
    }
}
