package com.sellerops.inquiry.decision;

import java.util.List;

/**
 * One need after the engine enforced the invariants on the judge's verdict.
 *
 * @param status      the final status (UNKNOWN may have been set by code, never by the judge)
 * @param evidence    the CURRENT evidence that supports it — only candidates that exist, never a past answer
 * @param precedents  REUSABLE past answers proposed for it, only when it is not covered
 * @param missing     what is still missing, for the seller
 * @param askCustomer what to ask the customer, for CONDITIONAL_ON_CUSTOMER
 * @param acquirable  the listing's detail was never read and reading it is a system step (SYSTEM_ACQUIRE)
 * @param judged      what the judge said before code enforced anything (null: the judge said nothing for this need)
 * @param enforcement why code moved the status away from {@code judged}, or null when it did not
 */
public record NeedResult(NeedStatus judged, InquiryNeed need, NeedStatus status, List<EvidenceCandidate> evidence,
                         List<PrecedentCandidate> precedents, String missing, String askCustomer, boolean acquirable,
                         Enforcement enforcement) {

    public NeedResult(InquiryNeed need, NeedStatus status, List<EvidenceCandidate> evidence,
                      List<PrecedentCandidate> precedents, String missing, String askCustomer, boolean acquirable) {
        this(status, need, status, evidence, precedents, missing, askCustomer, acquirable, null);
    }

    /**
     * The invariants code holds a verdict to — each one about the verdict's own words or about provenance, none about a
     * product or a topic ({@link NeedAggregation#enforce}).
     */
    public enum Enforcement {
        /** No verdict for this need came back. */
        NOT_JUDGED,
        /** A verdict of support citing no candidate that exists. */
        NO_CITED_EVIDENCE,
        /**
         * Every cited candidate was about a different instance of what the need is about — another listing, another
         * order. A fact about listing Y is not a fact about listing X (v2.1, generalised in v2.2).
         */
        OTHER_INSTANCE_ONLY,
        /**
         * FULL for a need about one instance (an order) with no cited candidate attributed to THAT instance — a company
         * rule may say what usually happens, never what happened to this order (v2.2). Becomes PARTIAL.
         */
        SCOPE_UNATTRIBUTED,
        /** FULL while naming an assumption not in the evidence (v2.2: FULL only — see NeedAggregation). */
        DECLARED_ASSUMPTION,
        /** FULL while naming information the answer requires and the evidence lacks. */
        DECLARED_MISSING,
        /** FULL while naming a value only the customer can supply — that is CONDITIONAL_ON_CUSTOMER. */
        DECLARED_CUSTOMER_INPUT,
        /** Short on readable evidence while a source this system cannot read exists — UNKNOWN, set by code. */
        UNREADABLE_SOURCE
    }
}
