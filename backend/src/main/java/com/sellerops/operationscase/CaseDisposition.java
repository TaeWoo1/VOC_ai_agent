package com.sellerops.operationscase;

/** The case's conclusion. Exactly the three the product allows. */
public enum CaseDisposition {
    /** Nothing for the seller to do; the case is closed as it is written. */
    AUTO_RESOLVED,
    /** Not the seller's move today; Reviewnary keeps it open and watches it. */
    MONITORING,
    /** The seller has to decide. */
    NEEDS_DECISION
}
