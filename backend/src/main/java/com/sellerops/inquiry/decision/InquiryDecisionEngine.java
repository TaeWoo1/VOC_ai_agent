package com.sellerops.inquiry.decision;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/**
 * <b>Inquiry Decision v2 — the call topology</b>, and nothing that knows a product or a word of Korean.
 *
 * <ol>
 *   <li><b>One planning call</b> splits the customer's message into independent needs.</li>
 *   <li><b>Retrieval, no model</b> (apart from the embedding the semantic lane already makes when F5 is on): the caller's
 *       collector gathers current evidence for every need at once and the past answers beside it.</li>
 *   <li><b>One judging call</b> reads every need against the one candidate list.</li>
 *   <li><b>Code</b> enforces the invariants and derives the basis ({@link NeedAggregation}).</li>
 * </ol>
 * Two model calls per inquiry, never one per need: the needs share one judge so they are judged against the same
 * evidence, and so the cost does not grow with the number of questions a customer packs into one message.
 *
 * <p>Pure apart from the two functions it is handed; a failure at any step is a decision of NO_ANSWER_BASIS with the
 * reason recorded, never a completed Case.
 */
public final class InquiryDecisionEngine {

    /** More needs than this is a message the planner could not split cleanly — the seller reads it. */
    static final int MAX_NEEDS = 6;
    /** The judge's candidate list is bounded; the collector ranks, this cuts. */
    static final int MAX_EVIDENCE = 30;
    static final int MAX_PRECEDENTS = 6;

    /** What the collector found, before ids: the engine numbers them so ids are positional and never leak a key. */
    public record Pool(List<EvidenceCandidate> evidence, List<PrecedentCandidate> precedents) {
    }

    private InquiryDecisionEngine() {
    }

    public static NeedDecision decide(UUID orgId, String question, InquiryDecisionModel model,
                                      Function<List<InquiryNeed>, Pool> collect, DetailCapability detail) {
        return decide(orgId, question, model, collect, detail, null);
    }

    /** @param productId the Case's resolved listing — what 「this listing's facts」 means when evidence is enforced */
    public static NeedDecision decide(UUID orgId, String question, InquiryDecisionModel model,
                                      Function<List<InquiryNeed>, Pool> collect, DetailCapability detail,
                                      UUID productId) {
        InquiryDecisionModel.Answer<List<InquiryNeed>> planned = model.plan(orgId, question);
        InquiryDecisionModel.CallCost cost = planned.cost();
        List<InquiryNeed> needs = planned.value();
        if (needs == null) {
            return NeedDecision.failed(NeedDecision.Outcome.PLAN_FAILED, cost, detail);
        }
        if (needs.isEmpty()) {
            return NeedDecision.failed(NeedDecision.Outcome.NO_NEEDS, cost, detail);
        }
        if (needs.size() > MAX_NEEDS) {
            return NeedDecision.failed(NeedDecision.Outcome.PLAN_FAILED, cost, detail);
        }
        Pool pool = collect.apply(needs);
        Map<String, EvidenceCandidate> evidence = new LinkedHashMap<>();
        for (EvidenceCandidate c : pool.evidence()) {
            if (evidence.size() >= MAX_EVIDENCE) {
                break;
            }
            String id = "E" + (evidence.size() + 1);
            evidence.put(id, c.withId(id));
        }
        Map<String, PrecedentCandidate> precedents = new LinkedHashMap<>();
        for (PrecedentCandidate p : pool.precedents()) {
            if (precedents.size() >= MAX_PRECEDENTS) {
                break;
            }
            String id = "P" + (precedents.size() + 1);
            precedents.put(id, new PrecedentCandidate(id, p.memoryId(), p.text()));
        }
        InquiryDecisionModel.Answer<Map<String, NeedVerdict>> judged = model.judge(orgId, question, needs,
                new ArrayList<>(evidence.values()), new ArrayList<>(precedents.values()));
        cost = cost.plus(judged.cost());
        if (judged.value() == null) {
            return NeedDecision.failed(NeedDecision.Outcome.JUDGE_FAILED, cost, detail);
        }
        List<NeedResult> results = NeedAggregation.enforce(needs, judged.value(), evidence, precedents, detail,
                productId);
        return new NeedDecision(NeedDecision.Outcome.DECIDED, results, NeedAggregation.basis(results), cost,
                evidence.size(), precedents.size(), detail);
    }
}
