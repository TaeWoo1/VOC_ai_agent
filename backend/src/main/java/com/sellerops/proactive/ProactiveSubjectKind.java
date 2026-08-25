package com.sellerops.proactive;

/**
 * What a proactive case is about.
 *
 * <p>Two, and the list is closed on purpose. An ORDER-only proactive case is deliberately absent
 * from v1: an order has no unanswered question and no waiting customer, so "확인이 필요합니다" on an
 * order would be a claim this product cannot yet ground. Naming the two kinds it CAN ground is what
 * lets {@code ProactiveSafetyFenceTest} assert the third does not exist.
 */
public enum ProactiveSubjectKind {

    /** A customer question the seller has not answered. The subject id is an {@code inquiries.id}. */
    INQUIRY,

    /** A review the existing triage already ranks 확인 필요. The subject id is a {@code reviews.id}. */
    REVIEW
}
