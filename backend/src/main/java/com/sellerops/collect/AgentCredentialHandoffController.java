package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.AgentCredentialHandoffRequest;
import com.sellerops.collect.dto.AgentCredentialHandoffResultView;
import com.sellerops.collect.dto.CredentialHandoffAuthorizationView;
import com.sellerops.collect.dto.CredentialHandoffAuthorizeRequest;
import jakarta.servlet.http.HttpServletRequest;
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

    /**
     * **Issue the seller's one-shot authorization.** Called by the SellerOps frontend, by the authenticated
     * seller, before the barrier they press — never by the agent, which holds no seller identity.
     *
     * <p>It reads nothing from the marketplace, stores nothing, and returns no secret: a capability bound to
     * this org, this user, this account, this channel and this run, good for minutes and for one handoff.
     */
    @PostMapping("/credential-handoff/authorize")
    public CredentialHandoffAuthorizationView authorize(@AuthenticationPrincipal AuthPrincipal principal,
                                                        @Valid @RequestBody CredentialHandoffAuthorizeRequest request) {
        return service.authorize(principal.orgId(), principal.userId(), request);
    }

    /** Write-only: stores the handed-off secrets, then runs the read-only connection check. */
    @PostMapping("/credential-handoff")
    public AgentCredentialHandoffResultView handOff(@AuthenticationPrincipal AuthPrincipal principal,
                                                    HttpServletRequest http,
                                                    @Valid @RequestBody AgentCredentialHandoffRequest request) {
        // The capability, when there is one, comes from the FILTER that already validated it — never from the
        // body. One source, and it is the one the authentication was derived from.
        Object capability = http.getAttribute(CredentialHandoffCapabilityFilter.ATTRIBUTE);
        return service.handOff(principal.orgId(), principal.userId(),
                capability instanceof String s ? s : null, request);
    }
}
