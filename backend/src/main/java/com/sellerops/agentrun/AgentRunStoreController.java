package com.sellerops.agentrun;

import com.sellerops.agentrun.dto.AgentRunClaimResponse;
import com.sellerops.agentrun.dto.AgentRunStateRequest;
import com.sellerops.agentrun.dto.AgentRunStateResponse;
import com.sellerops.auth.AuthPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The org-scoped durable run-state surface for the Agent Runtime. This is the ONLY way the runtime
 * touches run state — it never opens this database. Every route derives the org from the JWT principal
 * (never the body), so the store is tenant-isolated by construction.
 *
 * <p>Distinct from the frontend-facing {@code /api/agent-runs} surface, which is the Agent Runtime's own
 * HTTP service (a separate process). This backend surface is server-to-server: the runtime forwards the
 * operator's bearer here.
 */
@RestController
@RequestMapping("/api/agent-run-store")
public class AgentRunStoreController {

    private final AgentRunStoreService service;

    public AgentRunStoreController(AgentRunStoreService service) {
        this.service = service;
    }

    @GetMapping("/{threadId}")
    public AgentRunStateResponse get(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String threadId) {
        return service.get(principal.orgId(), threadId);
    }

    @PutMapping("/{threadId}")
    public AgentRunStateResponse upsert(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String threadId,
            @Valid @RequestBody AgentRunStateRequest request) {
        return service.upsert(principal.orgId(), threadId, request);
    }

    @PostMapping("/{threadId}/claim")
    public AgentRunClaimResponse claim(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String threadId) {
        return service.claim(principal.orgId(), threadId);
    }

    @DeleteMapping("/{threadId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable String threadId) {
        service.delete(principal.orgId(), threadId);
    }
}
