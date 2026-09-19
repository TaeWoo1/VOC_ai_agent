package com.sellerops.inquiry.decision;

import com.sellerops.inquiry.draft.AnswerBasisState;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * <b>The case policy, owned by code</b> (Inquiry Decision v2). Deterministic and pure.
 *
 * <p>The model decides what each need is and how far the evidence closes it. This class decides what the product
 * does with that, and it is the only place that does:
 * <ul>
 *   <li>every need FULL → {@link AnswerBasisState#GROUNDED};</li>
 *   <li>every need FULL or CONDITIONAL_ON_CUSTOMER, at least one conditional → {@link AnswerBasisState#NEEDS_CLARIFICATION};</li>
 *   <li><b>any need PARTIAL, NONE or UNKNOWN → {@link AnswerBasisState#NO_ANSWER_BASIS}</b>: the Case goes to the seller.
 *       There is no partial answer to a customer in this product — a reply that answers two of three questions reads as
 *       an answer to all three.</li>
 *   <li>no needs at all (the planner found nothing to answer) → NO_ANSWER_BASIS: nothing was judged, so nothing may be
 *       completed.</li>
 * </ul>
 * This is what removes partial-coverage leakage STRUCTURALLY: the old basis read 「a current passage exists」; this one
 * reads every need, and one uncovered need is enough to keep the Case away from the customer.
 */
public final class NeedAggregation {

    private NeedAggregation() {
    }

    public static AnswerBasisState basis(List<NeedResult> needs) {
        if (needs == null || needs.isEmpty()) {
            return AnswerBasisState.NO_ANSWER_BASIS;
        }
        boolean conditional = false;
        for (NeedResult n : needs) {
            if (!n.status().covered()) {
                return AnswerBasisState.NO_ANSWER_BASIS;
            }
            conditional |= n.status() == NeedStatus.CONDITIONAL_ON_CUSTOMER;
        }
        return conditional ? AnswerBasisState.NEEDS_CLARIFICATION : AnswerBasisState.GROUNDED;
    }

    /**
     * The judge's verdicts made safe, need by need:
     * <ul>
     *   <li>a need the judge did not answer is NONE;</li>
     *   <li>evidence ids that are not candidates are dropped; <b>FULL, CONDITIONAL and PARTIAL with no surviving evidence
     *       become NONE</b> — a verdict of support that cites nothing is not support;</li>
     *   <li>a precedent id cited as EVIDENCE is dropped (a past answer never grounds);</li>
     *   <li>precedents are kept only for uncovered needs and only when they are candidates;</li>
     *   <li>a listing need left PARTIAL/NONE while the listing's detail is unreadable becomes UNKNOWN; while it was never
     *       read, it is marked acquirable (the status stays — acquisition is a step, not an answer).</li>
     * </ul>
     */
    public static List<NeedResult> enforce(List<InquiryNeed> needs, Map<String, NeedVerdict> verdicts,
                                           Map<String, EvidenceCandidate> evidence,
                                           Map<String, PrecedentCandidate> precedents, DetailCapability detail) {
        List<NeedResult> out = new ArrayList<>(needs.size());
        for (InquiryNeed need : needs) {
            NeedVerdict v = verdicts.get(need.id());
            NeedStatus status = v == null || v.status() == null ? NeedStatus.NONE : v.status();
            List<EvidenceCandidate> cited = new ArrayList<>();
            if (v != null && v.evidence() != null) {
                for (String id : v.evidence()) {
                    EvidenceCandidate c = evidence.get(id);
                    if (c != null && !cited.contains(c)) {
                        cited.add(c);
                    }
                }
            }
            if (status != NeedStatus.NONE && cited.isEmpty()) {
                status = NeedStatus.NONE;
            }
            boolean acquirable = false;
            if (!status.covered() && need.type() != null && need.type().aboutTheListing()) {
                if (detail != null && detail.unreadable()) {
                    status = NeedStatus.UNKNOWN;
                } else if (detail == DetailCapability.NOT_ACQUIRED) {
                    acquirable = true;
                }
            }
            List<PrecedentCandidate> offered = new ArrayList<>();
            if (!status.covered() && v != null && v.precedents() != null) {
                for (String id : v.precedents()) {
                    PrecedentCandidate p = precedents.get(id);
                    if (p != null && !offered.contains(p)) {
                        offered.add(p);
                    }
                }
            }
            out.add(new NeedResult(need, status, List.copyOf(cited), List.copyOf(offered),
                    v == null ? null : v.missing(),
                    status == NeedStatus.CONDITIONAL_ON_CUSTOMER && v != null ? v.askCustomer() : null, acquirable));
        }
        return List.copyOf(out);
    }
}
