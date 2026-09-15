package com.sellerops.operationscase;

/** What an OperationsCase is about. Two, and the list is closed. */
public enum OperationsCaseKind {
    /** One customer inquiry or review that a run observed as new or changed. */
    CUSTOMER_WORK,
    /** A source Reviewnary could not read, for a reason only the seller can fix. */
    OBSERVATION_GAP
}
