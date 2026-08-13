package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.AgentCredentialHandoffRequest;
import com.sellerops.collect.dto.AgentCredentialHandoffResultView;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Local Agent's one credential route: the values a seller just issued on the marketplace, handed over by the
 * agent that read them under the seller's own trusted confirmation, and verified read-only.
 *
 * <p>Deliberately separate from {@code /api/seller-accounts/{id}/credentials} rather than a variant of it. That
 * route takes a seller-account id, which the Action Window wire refuses to carry; this one takes the opaque
 * account slot and resolves it server-side. Same vault, same validator, same connection check — one binding
 * apart.
 *
 * <p>The org comes from the JWT principal and never from the body, so the surface is tenant-isolated by
 * construction. The response carries no secret and no provider detail.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentCredentialHandoffController {

    private final AgentCredentialHandoffService service;

    public AgentCredentialHandoffController(AgentCredentialHandoffService service) {
        this.service = service;
    }

    /** Write-only: stores the handed-off secrets, then runs the read-only connection check. */
    @PostMapping("/credential-handoff")
    public AgentCredentialHandoffResultView handOff(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @Valid @RequestBody AgentCredentialHandoffRequest request) {
        return service.handOff(principal.orgId(), principal.userId(), request);
    }
}
