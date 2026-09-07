package com.sellerops.agent.llm.operator;

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
 * The Operator Graph's two model seams, server-side.
 *
 * <p>{@code agent-runtime} holds no vendor key, so the Operator's planner node and Evidence Judge node
 * reach a model by calling here with the operator's bearer token, exactly as every inquiry draft
 * reaches {@code InquiryDraftComposer}. The org comes from that token, so an operator cannot plan or judge on someone else's behalf,
 * and the backend stays the only LLM egress in the repository.
 *
 * <p>Both routes read nothing and write nothing: no work item is looked up, no state moves, nothing is
 * stored. A refusal is a {@code 200} with {@code available=false}, not an error status — "the
 * capability is off for your org" is a normal answer whose caller has a working fallback, and
 * surfacing it as a failure would turn a working run red.
 *
 * <p><b>The daily quota is charged here, before the model is reached.</b> This is the only egress, so
 * it is the only place a ceiling can be honest; charging inside {@code agent-runtime} would leave the
 * draft seam uncounted and would put the limit on the side of the wire that holds no key. An exhausted
 * quota returns the SAME refusal shape as a disabled capability, with a reason attached so the screen
 * can say which of the two happened.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentOperatorController {

    private final AgentPlanService planService;
    private final AgentJudgeService judgeService;
    /**
     * Who is spending this call — «USER» (the seller), «QA» or «BENCHMARK».
     *
     * <p>Believed only where {@code sellerops.agent.quota.trust-actor-header} is on, which is nowhere
     * by default. Everything metered either way; only USER is enforced against.
     */
    static final String ACTOR_HEADER = "X-Reviewnary-Usage-Actor";

    private final AgentQuotaService quota;

    public AgentOperatorController(AgentPlanService planService, AgentJudgeService judgeService,
                                   AgentQuotaService quota) {
        this.planService = planService;
        this.judgeService = judgeService;
        this.quota = quota;
    }

    @PostMapping("/plan")
    public PlanView plan(@AuthenticationPrincipal AuthPrincipal principal,
                         @RequestHeader(value = ACTOR_HEADER, required = false) String actorHeader,
                         @RequestBody PlanRequest request) {
        String version = planService.versionFor(principal.orgId());
        // Who is spending this call. Ignored — and therefore USER — unless the deployment opted in.
        QuotaDecision decision = quota.consume(principal.orgId(), AgentUsageKind.PLAN, request.runId(),
                quota.actorOf(actorHeader));
        if (!decision.allowed()) {
            return PlanView.quotaExhausted(version, decision.messageKo());
        }
        Optional<AgentOperatorResponseParser.ParsedPlan> plan =
                planService.plan(principal.orgId(), request.goalText(), request.toolCatalogue(),
                        request.priorContext(), request.isRetry());
        return plan
                .map(p -> new PlanView(true, p.supported(), p.userGoal(),
                        p.unresolvedEntities().stream()
                                .map(m -> new MentionView(m.kind(), m.mention())).toList(),
                        p.informationNeeds().stream()
                                .map(n -> new NeedView(n.id(), n.question(), n.kind(), n.why(), n.required()))
                                .toList(),
                        p.specialists(), p.tools(), p.retrievalOrder(), p.retrievalParallel(),
                        p.retrievalStopWhen(),
                        p.evidenceRequirements().stream()
                                .map(r -> new EvidenceRequirementView(r.needId(), r.minEvidence(),
                                        r.acceptableKinds()))
                                .toList(),
                        p.riskClass(), p.maxIterations(), p.maxToolCalls(), p.stopWhenEnough(),
                        p.clarificationNeeded(), p.clarificationReason(), p.rationale(),
                        p.requestedAction(), p.tone(),
                        new PlanFiltersView(p.filters().period(), p.filters().periodDays(), p.filters().rating(), p.filters().channel(),
                                p.filters().scope(), p.filters().topic(), p.filters().reviewIntent(),
                                p.filters().inquiryIntent(), p.filters().capabilityAspect(),
                                p.filters().limit(), p.filters().order(),
                                p.filters().status()),
                        new PlanTargetView(p.target().selector(), p.target().index()), version, null, null))
                .orElseGet(() -> PlanView.unavailable(version, planService.accessMessageFor(principal.orgId())));
    }

    @PostMapping("/judge")
    public JudgeView judge(@AuthenticationPrincipal AuthPrincipal principal,
                           @RequestHeader(value = ACTOR_HEADER, required = false) String actorHeader,
                           @RequestBody JudgeRequest request) {
        String version = judgeService.versionFor(principal.orgId());
        QuotaDecision decision = quota.consume(principal.orgId(), AgentUsageKind.JUDGE, request.runId(),
                quota.actorOf(actorHeader));
        if (!decision.allowed()) {
            return JudgeView.quotaExhausted(version, decision.messageKo());
        }
        Optional<AgentOperatorResponseParser.ParsedVerdict> verdict =
                judgeService.judge(principal.orgId(), request.finding(), request.evidenceDigest());
        return verdict
                .map(v -> new JudgeView(true, v.hasEvidence(), v.supportingEvidenceIds(),
                        v.unsafeAssertion(), v.unsafeReason(), v.needsMore(), v.needsMoreTool(),
                        v.needsMoreReason(), version, null))
                .orElseGet(() -> JudgeView.unavailable(version));
    }

    /**
     * The operator's own sentence and the caller's static tool catalogue. Nothing else is accepted.
     *
     * <p>{@code runId} is the caller's run identity, carried for one purpose: so a run that plans
     * three times spends ONE run slot of the daily quota instead of three. It is not used to look
     * anything up, and a null is honest — a call that belongs to no run is counted as a call only.
     */
    public record PlanRequest(String goalText, List<String> toolCatalogue, String priorContext,
                              String runId, Boolean retry) {

        /**
         * Whether this is a SECOND attempt at the same goal — the validator refused the first plan, or
         * the run came back to re-plan.
         *
         * <p>An explicit field rather than "is {@code priorContext} present", which is what Agent
         * Responsiveness v1 first tried and measured wrong: that field carries two unrelated things.
         * A re-plan's progress line, yes — but also the conversation's working-set line, which rides
         * along on ordinary FOLLOW-UP sentences. Reading the presence of the field as difficulty made
         * every second sentence in a conversation pay for deep reasoning (measured: 3.4s → 5.6-9.6s on
         * turns nothing had struggled with). Only the caller knows which it is, so the caller says.
         */
        public boolean isRetry() {
            return Boolean.TRUE.equals(retry);
        }
    }

    /** One thing the seller named. There is deliberately NO id field — see AgentPlanPrompt. */
    public record MentionView(String kind, String mention) {
    }

    /** One thing the plan needs to find out. The unit that makes two different goals two different plans. */
    public record NeedView(String id, String question, String kind, String why, boolean required) {
    }

    public record EvidenceRequirementView(String needId, int minEvidence, List<String> acceptableKinds) {
    }

    /** Closed filter tokens (v3). Every field nullable; null means "not narrowed". */
    public record PlanFiltersView(String period, Integer periodDays, String rating, String channel, String scope,
                                  String topic, String reviewIntent, String inquiryIntent, String capabilityAspect,
                                  Integer limit, String order, String status) {
        static PlanFiltersView none() {
            return new PlanFiltersView(null, null, null, null, null, null, null, null, null, null, null, null);
        }
    }

    /** Which member of the working set the seller meant (v3). {@code index} only for {@code NTH}. */
    public record PlanTargetView(String selector, Integer index) {
        static PlanTargetView none() {
            return new PlanTargetView("NONE", null);
        }
    }

    /** A SellerOps-composed sentence and a closed-vocabulary evidence digest. */
    public record JudgeRequest(String finding, String evidenceDigest, String runId) {
    }

    /**
     * @param available false when the capability is off for this org, or the model refused. The caller
     *     treats both identically (deterministic routing), which is why they are one field
     * @param requestedAction v3 — what the seller asked the runtime to DO; {@code NONE} when only a
     *     reading was asked for. Never a send: the closed set has no such value
     * @param filters v3 — closed narrowing tokens; a working-set follow-up carries {@code scope}
     * @param target v3 — which member of the working set the seller meant
     */
    public record PlanView(boolean available, boolean supported, String userGoal,
                           List<MentionView> unresolvedEntities, List<NeedView> informationNeeds,
                           List<String> specialists, List<String> tools, List<String> retrievalOrder,
                           List<String> retrievalParallel, String retrievalStopWhen,
                           List<EvidenceRequirementView> evidenceRequirements, String riskClass,
                           int maxIterations, int maxToolCalls, String stopWhenEnough,
                           boolean clarificationNeeded, String clarificationReason, String rationale,
                           String requestedAction, String tone, PlanFiltersView filters,
                           PlanTargetView target, String providerVersion, String quotaMessage,
                           String unavailableMessage) {

        /**
         * The capability produced no plan — and, when the reason is one the SELLER can act on, the
         * sentence saying so.
         *
         * <p>A separate field from {@code quotaMessage} on purpose: the runtime reads a quota message
         * as the AGENT_QUOTA_EXHAUSTED status, and "connect a channel first" is not a ceiling that was
         * met. Same {@code available=false} either way, so nothing new degrades down a fresh branch.
         */
        static PlanView unavailable(String version, String message) {
            return new PlanView(false, false, null, List.of(), List.of(), List.of(), List.of(),
                    List.of(), List.of(), null, List.of(), null, 0, 0, null, false, null, null,
                    "NONE", null, PlanFiltersView.none(), PlanTargetView.none(), version, null, message);
        }

        /**
         * Same {@code available=false} the caller already handles, plus the sentence for the seller.
         *
         * <p>Deliberately NOT a new status: a run that meets the ceiling must degrade along the path
         * that is already tested, not down a branch that only exists on the worst day.
         */
        static PlanView quotaExhausted(String version, String message) {
            return new PlanView(false, false, null, List.of(), List.of(), List.of(), List.of(),
                    List.of(), List.of(), null, List.of(), null, 0, 0, null, false, null, null,
                    "NONE", null, PlanFiltersView.none(), PlanTargetView.none(), version, message, null);
        }
    }

    public record JudgeView(boolean available, boolean hasEvidence, List<String> supportingEvidenceIds,
                            boolean unsafeAssertion, String unsafeReason, boolean needsMore,
                            String needsMoreTool, String needsMoreReason, String providerVersion,
                            String quotaMessage) {

        static JudgeView unavailable(String version) {
            return new JudgeView(false, false, List.of(), false, null, false, null, null, version, null);
        }

        static JudgeView quotaExhausted(String version, String message) {
            return new JudgeView(false, false, List.of(), false, null, false, null, null, version,
                    message);
        }
    }
}
