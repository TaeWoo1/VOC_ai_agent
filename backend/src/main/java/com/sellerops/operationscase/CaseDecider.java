package com.sellerops.operationscase;

/** Which layer concluded the case. The model is only ever reached for what the rules could not settle. */
public enum CaseDecider {
    RULE,
    AGENT
}
