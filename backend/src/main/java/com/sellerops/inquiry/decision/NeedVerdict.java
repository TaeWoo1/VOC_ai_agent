package com.sellerops.inquiry.decision;

import java.util.List;

/**
 * The coverage judge's word on one need, as parsed — before the engine enforces anything.
 *
 * <p>CoverageJudge v2 (Inquiry Decision v2.1) makes the judge say WHY, as structure rather than prose, so code can hold
 * the verdict to its own words ({@link NeedAggregation#enforce}): a FULL that names an assumption or a missing piece of
 * information is not a FULL. A v1 judge leaves the three lists empty and is read exactly as before.
 *
 * @param evidence       candidate ids ({@code E…}) the judge says support the verdict
 * @param missingInfo    information the answer requires that the evidence does not hold, one short phrase each
 * @param customerInput  values only the customer can supply that the answer depends on (CONDITIONAL_ON_CUSTOMER)
 * @param assumptions    anything the verdict leans on that is not in the evidence — a FULL must have none
 * @param askCustomer    what to ask the customer (for CONDITIONAL_ON_CUSTOMER)
 * @param precedents     precedent ids ({@code P…}) the judge proposes for this need — a general answer, not a statement
 *                       about one order or one moment
 */
public record NeedVerdict(String needId, NeedStatus status, List<String> evidence, List<String> missingInfo,
                          List<String> customerInput, List<String> assumptions, String askCustomer,
                          List<String> precedents) {

    public NeedVerdict {
        evidence = evidence == null ? List.of() : List.copyOf(evidence);
        missingInfo = missingInfo == null ? List.of() : List.copyOf(missingInfo);
        customerInput = customerInput == null ? List.of() : List.copyOf(customerInput);
        assumptions = assumptions == null ? List.of() : List.copyOf(assumptions);
        precedents = precedents == null ? List.of() : List.copyOf(precedents);
    }

    /** The v1 shape: one missing sentence, no structured reasons. */
    public static NeedVerdict of(String needId, NeedStatus status, List<String> evidence, String missing,
                                 String askCustomer, List<String> precedents) {
        return new NeedVerdict(needId, status, evidence, missing == null ? List.of() : List.of(missing), List.of(),
                List.of(), askCustomer, precedents);
    }

    /** What is missing, for the seller: the phrases joined, or null. */
    public String missing() {
        return missingInfo.isEmpty() ? null : String.join(" · ", missingInfo);
    }
}
