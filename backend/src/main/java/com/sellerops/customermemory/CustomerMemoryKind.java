package com.sellerops.customermemory;

/**
 * Which store a {@link CustomerMemoryEntry#getSourceId()} points into.
 *
 * <p>Two kinds and no more, on purpose. The product question customer memory answers is
 * "이 고객 문제를 전에 본 적이 있고, 그때 뭐라고 답했나" — which is an INQUIRY axis (past questions and
 * the answers given) crossed with a REVIEW axis (the reviews saying the same thing). An order or an
 * order summary is not a customer utterance and has no place in a retrieval index over them.
 */
public enum CustomerMemoryKind {
    INQUIRY,
    REVIEW
}
