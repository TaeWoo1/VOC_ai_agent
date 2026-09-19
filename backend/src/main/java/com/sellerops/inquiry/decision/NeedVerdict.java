package com.sellerops.inquiry.decision;

import java.util.List;

/**
 * The coverage judge's word on one need, as parsed — before the engine enforces anything.
 *
 * @param evidence    candidate ids ({@code E…}) the judge says support the verdict
 * @param missing     what is still missing, in the seller's words (for PARTIAL / NONE)
 * @param askCustomer what to ask the customer (for CONDITIONAL_ON_CUSTOMER)
 * @param precedents  precedent ids ({@code P…}) the judge says are a REUSABLE answer to this need — a general answer,
 *                    not a statement about one order or one moment
 */
public record NeedVerdict(String needId, NeedStatus status, List<String> evidence, String missing, String askCustomer,
                          List<String> precedents) {
}
