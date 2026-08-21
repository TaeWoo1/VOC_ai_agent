package com.sellerops.agent.llm.operator;

import com.sellerops.auth.AuthPrincipal;
import java.util.List;
import java.util.Optional;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Operator Graph's two model seams, server-side — siblings of {@code AgentDraftController}.
 *
 * <p>{@code agent-runtime} holds no vendor key, so the Operator's planner node and Evidence Judge node
 * reach a model by calling here with the operator's bearer token, exactly as the draft node already
 * does. The org comes from that token, so an operator cannot plan or judge on someone else's behalf,
 * and the backend stays the only LLM egress in the repository.
 *
 * <p>Both routes read nothing and write nothing: no work item is looked up, no state moves, nothing is
 * stored. A refusal is a {@code 200} with {@code available=false}, not an error status — "the
 * capability is off for your org" is a normal answer whose caller has a working fallback, and
 * surfacing it as a failure would turn a working run red.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentOperatorController {

    private final AgentPlanService planService;
    private final AgentJudgeService judgeService;

    public AgentOperatorController(AgentPlanService planService, AgentJudgeService judgeService) {
        this.planService = planService;
        this.judgeService = judgeService;
    }

    @PostMapping("/plan")
    public PlanView plan(@AuthenticationPrincipal AuthPrincipal principal,
                         @RequestBody PlanRequest request) {
        String version = planService.versionFor(principal.orgId());
        Optional<AgentOperatorResponseParser.ParsedPlan> plan =
                planService.plan(principal.orgId(), request.goalText(), request.toolCatalogue(),
                        request.priorContext());
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
                        p.clarificationNeeded(), p.clarificationReason(), p.rationale(), version))
                .orElseGet(() -> PlanView.unavailable(version));
    }

    @PostMapping("/judge")
    public JudgeView judge(@AuthenticationPrincipal AuthPrincipal principal,
                           @RequestBody JudgeRequest request) {
        String version = judgeService.versionFor(principal.orgId());
        Optional<AgentOperatorResponseParser.ParsedVerdict> verdict =
                judgeService.judge(principal.orgId(), request.finding(), request.evidenceDigest());
        return verdict
                .map(v -> new JudgeView(true, v.hasEvidence(), v.supportingEvidenceIds(),
                        v.unsafeAssertion(), v.unsafeReason(), v.needsMore(), v.needsMoreTool(),
                        v.needsMoreReason(), version))
                .orElseGet(() -> JudgeView.unavailable(version));
    }

    /** The operator's own sentence and the caller's static tool catalogue. Nothing else is accepted. */
    public record PlanRequest(String goalText, List<String> toolCatalogue, String priorContext) {
    }

    /** One thing the seller named. There is deliberately NO id field — see AgentPlanPrompt. */
    public record MentionView(String kind, String mention) {
    }

    /** One thing the plan needs to find out. The unit that makes two different goals two different plans. */
    public record NeedView(String id, String question, String kind, String why, boolean required) {
    }

    public record EvidenceRequirementView(String needId, int minEvidence, List<String> acceptableKinds) {
    }

    /** A SellerOps-composed sentence and a closed-vocabulary evidence digest. */
    public record JudgeRequest(String finding, String evidenceDigest) {
    }

    /**
     * @param available false when the capability is off for this org, or the model refused. The caller
     *     treats both identically (deterministic routing), which is why they are one field
     */
    public record PlanView(boolean available, boolean supported, String userGoal,
                           List<MentionView> unresolvedEntities, List<NeedView> informationNeeds,
                           List<String> specialists, List<String> tools, List<String> retrievalOrder,
                           List<String> retrievalParallel, String retrievalStopWhen,
                           List<EvidenceRequirementView> evidenceRequirements, String riskClass,
                           int maxIterations, int maxToolCalls, String stopWhenEnough,
                           boolean clarificationNeeded, String clarificationReason, String rationale,
                           String providerVersion) {

        static PlanView unavailable(String version) {
            return new PlanView(false, false, null, List.of(), List.of(), List.of(), List.of(),
                    List.of(), List.of(), null, List.of(), null, 0, 0, null, false, null, null, version);
        }
    }

    public record JudgeView(boolean available, boolean hasEvidence, List<String> supportingEvidenceIds,
                            boolean unsafeAssertion, String unsafeReason, boolean needsMore,
                            String needsMoreTool, String needsMoreReason, String providerVersion) {

        static JudgeView unavailable(String version) {
            return new JudgeView(false, false, List.of(), false, null, false, null, null, version);
        }
    }
}
