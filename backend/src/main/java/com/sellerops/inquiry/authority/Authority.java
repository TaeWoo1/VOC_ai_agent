package com.sellerops.inquiry.authority;

/**
 * <b>Who may close a customer need</b> (Inquiry Architecture v3, product-owner decision 2026-09-20). Four values, none
 * of them a business domain: shipping, refunds and sizes are instances, not authorities.
 *
 * <p>What is deliberately NOT here: the customer (a required input to a step, {@link CustomerInput}), a capability gap
 * (a resolution state, {@link ResolutionState#CAPABILITY_GAP}) and a past answer (a precedent — memory, never grounding).
 */
public enum Authority {
    /** What the seller published or taught — product knowledge, documents, company policy, catalogue structure. */
    KNOWLEDGE,
    /** What is true NOW about one instance — this order, this listing's selling state. Only a connector says it. */
    ENTITY_STATE,
    /** Something must be DONE — preconditions, policy, an action behind approval. Never closed by a sentence. */
    PROCEDURE,
    /** No authoritative source exists; the seller's new judgment is needed. */
    SELLER
}
