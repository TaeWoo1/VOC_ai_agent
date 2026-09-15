package com.sellerops.operationscase;

/** How far preparation got. Same tokens as the proactive column; a prepared draft is not an approval. */
public enum CasePreparedAction {
    DRAFT_PREPARED,
    RECOMMENDATION_ONLY,
    NONE
}
