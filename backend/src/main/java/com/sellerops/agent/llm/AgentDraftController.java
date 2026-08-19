package com.sellerops.agent.llm;

import com.sellerops.agent.llm.dto.AgentDraftRequest;
import com.sellerops.agent.llm.dto.AgentDraftView;
import java.util.Optional;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.sellerops.auth.AuthPrincipal;

/**
 * The Agent Runtime's model seam, server-side.
 *
 * <p>{@code agent-runtime} holds no vendor key — its own {@code .env.example} says so in the first
 * paragraph ("the service holds NO channel credential and NO JWT signing secret") — so the LangGraph
 * draft node reaches a real model by calling here with the operator's bearer token, exactly as it
 * reaches every other backend capability. The org comes from that token, so an operator cannot ask
 * for a draft on someone else's behalf, and the backend stays the only LLM egress in the repository.
 *
 * <p>Authenticated like every other {@code /api/**} route (SecurityConfig's {@code anyRequest()
 * .authenticated()}). It reads nothing and writes nothing: no work item is looked up, no state moves,
 * no draft is stored. A refusal is a 200 with {@code available=false}, not an error status — "the
 * capability is off for your org" is a normal answer here and the caller's fallback is the shipped
 * behaviour, so surfacing it as a failure would turn a working run into a red one.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentDraftController {

    private final AgentDraftService service;

    public AgentDraftController(AgentDraftService service) {
        this.service = service;
    }

    @PostMapping("/inquiry-draft")
    public AgentDraftView draft(@AuthenticationPrincipal AuthPrincipal principal,
                                @RequestBody AgentDraftRequest request) {
        String version = service.versionFor(principal.orgId());
        Optional<AgentDraftResponseParser.ParsedDraft> draft =
                service.draft(principal.orgId(), request.title(), request.details());
        return draft
                .map(d -> new AgentDraftView(true, d.category(), d.title(), d.comments(), version))
                .orElseGet(() -> AgentDraftView.unavailable(version));
    }
}
