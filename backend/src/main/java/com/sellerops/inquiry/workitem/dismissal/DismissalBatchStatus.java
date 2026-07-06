package com.sellerops.inquiry.workitem.dismissal;

/**
 * Lifecycle status of a dismissal batch. A batch row is written only on a fully
 * successful, all-or-nothing execution, so {@link #EXECUTED} is the only status this
 * slice ever persists; the enum stays open for later states (e.g. a future reversal).
 */
public enum DismissalBatchStatus {
    EXECUTED
}
