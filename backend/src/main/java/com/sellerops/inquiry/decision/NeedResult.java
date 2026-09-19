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
 */
public record NeedResult(InquiryNeed need, NeedStatus status, List<EvidenceCandidate> evidence,
                         List<PrecedentCandidate> precedents, String missing, String askCustomer, boolean acquirable) {
}
