package com.sellerops.operationscase;

/** Who a case event is attributed to. SELLER is for a seller action read back from its own canonical record. */
public enum CaseEventActor {
    SYSTEM,
    AGENT,
    SELLER
}
