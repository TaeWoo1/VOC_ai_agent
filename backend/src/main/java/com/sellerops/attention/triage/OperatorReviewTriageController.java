package com.sellerops.attention.triage;

import com.sellerops.attention.triage.dto.TriageDecisionRequest;
import com.sellerops.attention.triage.dto.TriageDecisionResponse;
import com.sellerops.auth.AuthPrincipal;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The write half of the operator attention surface: record what an operator decided about
 * one drill-down row. Thin delegate over {@link ReviewTriageService}; {@code orgId} always
 * comes from the authenticated principal, never the client.
 *
 * <p>Kept separate from {@code OperatorAttentionController} rather than added to it. That
 * controller is a pure read delegate over a metadata-only projection, and its contract is
 * pinned as such by {@code OperatorAttentionItemsJsonContractTest}; folding a write into it
 * would make one class answer for both a read model and a state transition, and would make
 * every read-contract test carry a mock of the write service. The routes stay in one family
 * under {@code /api/seller-accounts/{accountId}/attention}.
 *
 * <p>The nesting is real scoping, not cosmetic URL shape: {@code accountId} is what the
 * service authorizes the ref against (see {@link ReviewTriageService}).
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/attention")
public class OperatorReviewTriageController {

    private final ReviewTriageService service;

    public OperatorReviewTriageController(ReviewTriageService service) {
        this.service = service;
    }

    /**
     * Record the operator's decision on the row named by {@code actionRef}.
     *
     * <p>{@code actionRef} is the opaque ref the drill-down handed out
     * ({@code review:<uuid>}); clients round-trip it and never parse it. It is an address,
     * not a token — possession authorizes nothing, and the service re-derives the caller's
     * org and account/channel scope on every call.
     *
     * <p>POST rather than PUT, though the decision itself is a replaceable single value: a
     * PUT would say the client names the resource and may create it at that address, which
     * is exactly what is not true here. The row already exists (it was ingested); the
     * client is submitting a command against it, and the command carries its own
     * idempotency key. Idempotency comes from {@code commandId}, not from the verb.
     *
     * <p>Returns 200 for both a fresh write and an exact replay (distinguished by
     * {@code replayed}); 400 for a malformed/unsupported ref or an unknown disposition; 404
     * when the ref is not addressable from this account; 409 when the command id was
     * already spent on a different decision.
     */
    @PostMapping("/items/{actionRef}/triage")
    public TriageDecisionResponse triage(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @PathVariable String actionRef,
            @RequestBody TriageDecisionRequest request) {
        return service.decide(principal.orgId(), accountId, actionRef,
                request.disposition(), request.commandId(), principal.userId());
    }
}
