package com.sellerops.collect.capability;

import com.sellerops.auth.AuthPrincipal;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The NAVER guided-connection wizard's capability-result surface: a read-only capability check for
 * one connected NAVER account. Org-scoped via {@code principal.orgId()} — a foreign/unknown account
 * id is a 404.
 *
 * <p><b>GET, not POST:</b> unlike the Cafe24 first-connection check (which performs a live token
 * refresh), this reads only persisted state (credential presence + latest order-sync outcome) and
 * has no side effect, so it is a safe idempotent GET. It never calls the marketplace and writes
 * nothing. The response is fully sanitized (no token, id, order id, or personal data).
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}")
public class ConnectionCapabilityController {

    private final ConnectionCapabilityService service;

    public ConnectionCapabilityController(ConnectionCapabilityService service) {
        this.service = service;
    }

    /** Read-only capability result for the wizard's completion screen. */
    @GetMapping("/connection-capability")
    public ConnectionCapabilityView connectionCapability(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable UUID accountId) {
        return service.capability(principal.orgId(), accountId);
    }
}
