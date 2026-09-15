package com.sellerops.operationscase;

/**
 * The subject column of an OperationsCase row. A superset of the proactive loop's two kinds: {@link #SOURCE} names
 * a seller account whose collection could not run, and only an {@link OperationsCaseKind#OBSERVATION_GAP} carries it.
 */
public enum OperationsSubjectKind {
    INQUIRY,
    REVIEW,
    SOURCE
}
