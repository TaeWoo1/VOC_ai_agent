package com.sellerops.inquiry.decision;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.inquiry.draft.AnswerBasisState;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The need-level decision for one inquiry (Inquiry Decision v2): what the customer needs, how far each need is
 * covered, and the basis code derived from that.
 *
 * @param outcome {@code DECIDED}, or why no decision was reached ({@code PLAN_FAILED}, {@code JUDGE_FAILED},
 *                {@code NO_NEEDS}). A Case with no decision is never completed for the customer.
 */
public record NeedDecision(Outcome outcome, List<NeedResult> needs, AnswerBasisState basis,
                           InquiryDecisionModel.CallCost cost, int evidenceCandidates, int precedentCandidates,
                           DetailCapability detail) {

    public enum Outcome { DECIDED, PLAN_FAILED, JUDGE_FAILED, NO_NEEDS }

    public List<NeedResult> covered() {
        return needs.stream().filter(n -> n.status().covered()).toList();
    }

    public List<NeedResult> unresolved() {
        return needs.stream().filter(n -> !n.status().covered()).toList();
    }

    /** Some need is short only because the listing's detail was never read — reading it is the next step. */
    public boolean acquisitionPlanned() {
        return needs.stream().anyMatch(NeedResult::acquirable);
    }

    /** What a drafter is shown: the evidence of the covered needs, once each — and nothing a need did not cite. */
    public List<AgentDraftGenerator.Passage> passages() {
        Set<EvidenceCandidate> seen = new LinkedHashSet<>();
        for (NeedResult n : covered()) {
            seen.addAll(n.evidence());
        }
        List<AgentDraftGenerator.Passage> out = new ArrayList<>();
        for (EvidenceCandidate e : seen) {
            out.add(new AgentDraftGenerator.Passage(e.kind().scopeLabelKo(), e.label(), e.text()));
        }
        return out;
    }

    /**
     * The drafter's scope line: which needs this reply answers and which it only asks the customer about. Written by
     * us from the needs, never from the evidence text — it tells the drafter what to cover, not what is true.
     */
    public String answerScope() {
        StringBuilder sb = new StringBuilder();
        for (NeedResult n : needs) {
            sb.append("- ").append(n.need().ask());
            if (n.status() == NeedStatus.CONDITIONAL_ON_CUSTOMER) {
                sb.append(" → 고객에게 확인: ").append(n.askCustomer() == null ? "필요한 정보" : n.askCustomer());
            }
            sb.append('\n');
        }
        return sb.toString().strip();
    }

    public static NeedDecision failed(Outcome why, InquiryDecisionModel.CallCost cost, DetailCapability detail) {
        return new NeedDecision(why, List.of(), AnswerBasisState.NO_ANSWER_BASIS, cost, 0, 0, detail);
    }
}
