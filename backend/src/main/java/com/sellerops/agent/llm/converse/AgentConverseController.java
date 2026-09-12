package com.sellerops.agent.llm.converse;

import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.auth.AuthPrincipal;
import java.util.List;
import java.util.Optional;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Grounded Conversation lane's model seam, server-side.
 *
 * <p>{@code agent-runtime} holds no vendor key, so the conversation lane reaches a model by calling
 * here with the operator's bearer token — the org comes from that token, and the backend stays the only
 * LLM egress in the repository.
 *
 * <p>This route reads nothing and writes nothing. A refusal is a {@code 200} with
 * {@code available=false}, not an error status: "the capability is off for your org" is a normal answer
 * whose caller has a working fallback (the deterministic composer), and surfacing it as a failure would
 * turn a working turn red.
 *
 * <p><b>The daily quota is charged here, before the model is reached</b> — same as plan and judge, and
 * for the same reason: this is the only egress, so it is the only place a ceiling can be honest.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentConverseController {

    static final String ACTOR_HEADER = "X-Reviewnary-Usage-Actor";

    private final AgentConverseService converseService;
    private final AgentQuotaService quota;

    public AgentConverseController(AgentConverseService converseService, AgentQuotaService quota) {
        this.converseService = converseService;
        this.quota = quota;
    }

    @PostMapping("/converse")
    public ConverseView converse(@AuthenticationPrincipal AuthPrincipal principal,
                                 @RequestHeader(value = ACTOR_HEADER, required = false) String actorHeader,
                                 @RequestBody ConverseRequest request) {
        String version = converseService.versionFor(principal.orgId());
        QuotaDecision decision = quota.consume(principal.orgId(), AgentUsageKind.CONVERSE, request.runId(),
                quota.actorOf(actorHeader));
        if (!decision.allowed()) {
            return ConverseView.unavailable(version, AgentConverseService.Reason.UNAVAILABLE);
        }
        AgentConverseService.Outcome outcome = converseService.converse(principal.orgId(), request.question(),
                orEmpty(request.facts()), orEmpty(request.context()), orEmpty(request.recentTurns()));
        return outcome.answer()
                .map(a -> new ConverseView(true, a, version, outcome.reason().name()))
                .orElseGet(() -> ConverseView.unavailable(version, outcome.reason()));
    }

    private static List<String> orEmpty(List<String> values) {
        return values == null ? List.of() : values;
    }

    /**
     * The four sections the prompt accepts. There is deliberately no field for an object id, a customer
     * body or a draft — a request shape that cannot carry one is the floor that does not depend on care.
     */
    public record ConverseRequest(String question, List<String> facts, List<String> context,
                                  List<String> recentTurns, String runId) {
    }

    /**
     * @param available false when the capability is off for this org, the quota is met, the floor
     *     refused the request, or the model declined. The caller treats all of them identically — it
     *     composes the deterministic answer — which is why they are one field.
     */
    /**
     * @param reason a closed token saying WHY when {@code available} is false. The caller treats most of
     *     them identically — it composes the deterministic answer — but {@code NO_BASIS} is the model
     *     having read the whole fact sheet and found nothing, which is a different sentence to a seller
     *     than a capability that is switched off.
     */
    public record ConverseView(boolean available, String answer, String providerVersion, String reason) {

        static ConverseView unavailable(String version, AgentConverseService.Reason reason) {
            return new ConverseView(false, null, version, reason.name());
        }
    }
}
