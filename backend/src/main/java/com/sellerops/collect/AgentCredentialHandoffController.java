package com.sellerops.collect;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.SellerCredentialHandoffRequest;
import com.sellerops.common.ApiException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.util.Set;
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
    private final ObjectMapper mapper;
    private final Validator validator;

    public AgentCredentialHandoffController(AgentCredentialHandoffService service, ObjectMapper mapper,
                                            Validator validator) {
        this.service = service;
        this.mapper = mapper;
        this.validator = validator;
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

    /**
     * Write-only: stores the handed-off secrets, then runs the read-only connection check.
     *
     * <p><b>One route, two contracts, chosen by how the caller authenticated.</b> The body is read as JSON and
     * bound to the record that belongs to that caller — the operator's, which names an account slot, or the
     * seller's, which names none because its capability already does. Binding a single record with conditional
     * fields would make "what must I send" a question you answer by reading the service; this makes it a
     * question you answer by reading which credential you hold.
     */
    @PostMapping("/credential-handoff")
    public AgentCredentialHandoffResultView handOff(@AuthenticationPrincipal AuthPrincipal principal,
                                                    HttpServletRequest http,
                                                    @RequestBody JsonNode body) {
        // The capability, when there is one, comes from the FILTER that already validated it — never from the
        // body. One source, and it is the one the authentication was derived from.
        Object capability = http.getAttribute(CredentialHandoffCapabilityFilter.ATTRIBUTE);
        if (capability instanceof String capabilityId) {
            // **A capability-authenticated request may not name an account.** Carrying `accountSlot` anyway means
            // the caller believes it is choosing the account — and the answer to that is no, not "we checked and
            // they matched". Refused before anything is read.
            if (body.hasNonNull("accountSlot")) {
                throw ApiException.badRequest(
                        "이 요청은 판매 계정을 지정할 수 없습니다. 저장된 것은 없습니다. (" + REASON_SLOT_NOT_ACCEPTED + ")");
            }
            return service.handOffWithCapability(capabilityId, validated(body, SellerCredentialHandoffRequest.class));
        }
        return service.handOff(principal.orgId(), principal.userId(),
                validated(body, AgentCredentialHandoffRequest.class));
    }

    /** Safe reason: a capability-authenticated request tried to name the account its capability already names. */
    static final String REASON_SLOT_NOT_ACCEPTED = "HANDOFF_ACCOUNT_SLOT_NOT_ACCEPTED";

    /**
     * Bind and validate one of the two contracts. `@Valid` cannot do this for us — the parameter is a JsonNode,
     * because WHICH record applies is decided by the authentication rather than by the route — so the same
     * constraints are applied here explicitly, and a violation is a 400 with the record's own message.
     */
    private <T> T validated(JsonNode body, Class<T> type) {
        T bound;
        try {
            bound = mapper.treeToValue(body, type);
        } catch (JsonProcessingException e) {
            // The exception is not echoed: a binding error can quote the body, and the body holds three secrets.
            throw ApiException.badRequest("요청 형식이 올바르지 않습니다.");
        }
        Set<ConstraintViolation<T>> violations = validator.validate(bound);
        if (!violations.isEmpty()) {
            throw ApiException.badRequest(violations.iterator().next().getMessage());
        }
        return bound;
    }
}
