package com.sellerops.attention.reply;

/**
 * What SellerOps actually CONFIRMED about a reported reply submission — separate from
 * {@link OperatorOutcome}, which is what the operator reported.
 *
 * <p><b>Only {@code UNVERIFIED} exists, and that is the whole point.</b> A NAVER review reply post
 * has no read-back oracle — NAVER exposes no REVIEW API and the export carries no reply state — so
 * SellerOps can never confirm a reply landed. A {@code VERIFIED} value is deliberately NOT present:
 * an absent enum member cannot be written by mistake, so the record can never claim a verification
 * that cannot happen. If a read-back path ever exists, adding the value is a deliberate, reviewed act.
 */
public enum VerificationState {

    /** SellerOps did not (and cannot) confirm the reply was posted. The only reachable value. */
    UNVERIFIED
}
