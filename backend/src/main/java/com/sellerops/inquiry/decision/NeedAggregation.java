package com.sellerops.inquiry.decision;

import com.sellerops.inquiry.draft.AnswerBasisState;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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
     *   <li><b>evidence must be about the instance the need is about</b> (v2.2, generalising v2.1's other-listing fence):
     *       for a need about one listing or one order ({@link NeedType#instanceScope()}), a cited candidate attributed to
     *       a DIFFERENT instance of that kind ({@link EvidenceScope}) is dropped before the rule above — a fact about
     *       listing Y is not a fact about listing X, and order Y's state is not order X's. And for an ORDER need a FULL
     *       requires at least one cited candidate attributed to THIS order: otherwise it is PARTIAL — a company rule says
     *       what usually happens, never what happened to this order ({@link NeedType#fullRequiresAttributedEvidence()}).
     *       Availability needs name no instance: 「do you sell another size」 is answered by another listing existing;</li>
     *   <li><b>the verdict is held to its own words</b> (CoverageJudge v2): a <b>FULL</b> that names an assumption not in
     *       the evidence is PARTIAL; a FULL that names missing information is PARTIAL; a FULL that names a value only the
     *       customer can supply is CONDITIONAL_ON_CUSTOMER. <b>A CONDITIONAL is not downgraded for naming an
     *       assumption</b> (v2.2): the A/B run (apr-8ef649ab) measured that rule at zero unsafe verdicts caught and one
     *       correct CONDITIONAL lost — a judge describing what it cannot know about the customer is doing its job.
     *       None of this reads the words — only whether the judge filled the list;</li>
     *   <li>a precedent id cited as EVIDENCE is dropped (a past answer never grounds);</li>
     *   <li>precedents are kept only for uncovered needs and only when they are candidates;</li>
     *   <li>a listing need left PARTIAL/NONE while the listing's detail is unreadable becomes UNKNOWN; while it was never
     *       read, it is marked acquirable (the status stays — acquisition is a step, not an answer).</li>
     * </ul>
     */
    public static List<NeedResult> enforce(List<InquiryNeed> needs, Map<String, NeedVerdict> verdicts,
                                           Map<String, EvidenceCandidate> evidence,
                                           Map<String, PrecedentCandidate> precedents, DetailCapability detail) {
        return enforce(needs, verdicts, evidence, precedents, detail, EvidenceScope.CaseScope.NONE);
    }

    public static List<NeedResult> enforce(List<InquiryNeed> needs, Map<String, NeedVerdict> verdicts,
                                           Map<String, EvidenceCandidate> evidence,
                                           Map<String, PrecedentCandidate> precedents, DetailCapability detail,
                                           UUID caseProductId) {
        return enforce(needs, verdicts, evidence, precedents, detail,
                new EvidenceScope.CaseScope(caseProductId, null));
    }

    public static List<NeedResult> enforce(List<InquiryNeed> needs, Map<String, NeedVerdict> verdicts,
                                           Map<String, EvidenceCandidate> evidence,
                                           Map<String, PrecedentCandidate> precedents, DetailCapability detail,
                                           EvidenceScope.CaseScope caseScope) {
        EvidenceScope.CaseScope scope = caseScope == null ? EvidenceScope.CaseScope.NONE : caseScope;
        List<NeedResult> out = new ArrayList<>(needs.size());
        for (InquiryNeed need : needs) {
            NeedVerdict v = verdicts.get(need.id());
            NeedStatus judged = v == null ? null : v.status();
            NeedStatus status = judged == null ? NeedStatus.NONE : judged;
            NeedResult.Enforcement why = judged == null ? NeedResult.Enforcement.NOT_JUDGED : null;
            EvidenceScope.Kind about = need.type() == null ? null : need.type().instanceScope();
            String instance = about == null ? null : scope.idOf(about);
            List<EvidenceCandidate> cited = new ArrayList<>();
            boolean foreignDropped = false;
            if (v != null) {
                for (String id : v.evidence()) {
                    EvidenceCandidate c = evidence.get(id);
                    if (c == null || cited.contains(c)) {
                        continue;
                    }
                    if (about != null && instance != null && c.scope() != null && c.scope().kind() == about
                            && c.scope().id() != null && !instance.equals(c.scope().id())) {
                        foreignDropped = true; // attributed to another instance of what this need is about
                        continue;
                    }
                    cited.add(c);
                }
            }
            if (status != NeedStatus.NONE && cited.isEmpty()) {
                why = why != null ? why : foreignDropped ? NeedResult.Enforcement.OTHER_INSTANCE_ONLY
                        : NeedResult.Enforcement.NO_CITED_EVIDENCE;
                status = NeedStatus.NONE;
            }
            if (status == NeedStatus.FULL && need.type() != null && need.type().fullRequiresAttributedEvidence()
                    && cited.stream().noneMatch(c -> c.scope() != null && c.scope().kind() == about
                            && c.scope().id() != null && c.scope().id().equals(instance))) {
                status = NeedStatus.PARTIAL;
                why = NeedResult.Enforcement.SCOPE_UNATTRIBUTED;
            } else if (v != null && status == NeedStatus.FULL && !v.assumptions().isEmpty()) {
                status = NeedStatus.PARTIAL;
                why = NeedResult.Enforcement.DECLARED_ASSUMPTION;
            } else if (v != null && status == NeedStatus.FULL && !v.missingInfo().isEmpty()) {
                status = NeedStatus.PARTIAL;
                why = NeedResult.Enforcement.DECLARED_MISSING;
            } else if (v != null && status == NeedStatus.FULL && !v.customerInput().isEmpty()) {
                status = NeedStatus.CONDITIONAL_ON_CUSTOMER;
                why = NeedResult.Enforcement.DECLARED_CUSTOMER_INPUT;
            }
            boolean acquirable = false;
            if (!status.covered() && need.type() != null && need.type().aboutTheListing()) {
                if (detail != null && detail.unreadable()) {
                    status = NeedStatus.UNKNOWN;
                    why = why != null ? why : NeedResult.Enforcement.UNREADABLE_SOURCE;
                } else if (detail == DetailCapability.NOT_ACQUIRED) {
                    acquirable = true;
                }
            }
            List<PrecedentCandidate> offered = new ArrayList<>();
            if (!status.covered() && v != null) {
                for (String id : v.precedents()) {
                    PrecedentCandidate p = precedents.get(id);
                    if (p != null && !offered.contains(p)) {
                        offered.add(p);
                    }
                }
            }
            String askCustomer = null;
            if (status == NeedStatus.CONDITIONAL_ON_CUSTOMER && v != null) {
                askCustomer = v.askCustomer() != null ? v.askCustomer()
                        : v.customerInput().isEmpty() ? null : String.join(" · ", v.customerInput());
            }
            out.add(new NeedResult(judged, need, status, List.copyOf(cited), List.copyOf(offered),
                    v == null ? null : v.missing(), askCustomer, acquirable, status == judged ? null : why));
        }
        return List.copyOf(out);
    }
}
