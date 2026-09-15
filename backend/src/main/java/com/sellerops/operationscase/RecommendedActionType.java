package com.sellerops.operationscase;

/**
 * The closed vocabulary of what an investigation may recommend, with the authority each one needs.
 *
 * <p><b>Only watching and doing nothing are Reviewnary's own.</b> A customer message, money, a cancellation, and
 * also a knowledge or listing change (policy is the seller's to change — decision memory never writes it) all need
 * the seller. A case whose recommendation needs HUMAN authority cannot be AUTO_RESOLVED or MONITORING, whatever the
 * model said.
 */
public enum RecommendedActionType {
    NO_ACTION(RequiredAuthority.AUTO),
    MONITOR_REPEAT_ISSUE(RequiredAuthority.AUTO),
    REPLY_TO_CUSTOMER(RequiredAuthority.HUMAN),
    CONTACT_CUSTOMER(RequiredAuthority.HUMAN),
    REFUND_OR_COMPENSATION(RequiredAuthority.HUMAN),
    CANCEL_OR_EXCHANGE(RequiredAuthority.HUMAN),
    ADD_KNOWLEDGE(RequiredAuthority.HUMAN),
    REVIEW_PRODUCT_LISTING(RequiredAuthority.HUMAN);

    private final RequiredAuthority authority;

    RecommendedActionType(RequiredAuthority authority) {
        this.authority = authority;
    }

    public RequiredAuthority authority() {
        return authority;
    }
}
