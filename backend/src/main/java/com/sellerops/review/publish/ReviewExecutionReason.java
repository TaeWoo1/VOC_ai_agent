package com.sellerops.review.publish;

/**
 * Why a review reply execution was {@code REFUSED} — closed, and split into the two things a seller
 * can do about it: wait or fix something ({@link #retryable()}), or stop (permanent).
 */
public enum ReviewExecutionReason {
    /** The execution flag / connector is off, or the channel has no API lane at all. */
    EXECUTION_DISABLED(true),
    /** The seller has not granted {@code mall.write_community}. Sendable once they do. */
    WRITE_GRANT_MISSING(true),
    /** The deployment has no armed live-run approval id for this transport. */
    NOT_ARMED(true),
    /** {@code shop_no} is unobserved in this deployment. */
    SHOP_NO_UNSET(true),
    /** The connection could not be opened or refreshed. */
    AUTH_FAILED(true),
    /** The channel rate-limited the one request; nothing was created. */
    RATE_LIMITED(true),
    /** The review is not a marketplace object ({@code executableIdentity = NONE}). */
    NOT_MARKETPLACE_OBJECT(false),
    /** The review's external id names no board article. */
    TARGET_UNPARSEABLE(false),
    /** The channel refused the body (4xx). Re-sending it unchanged would be refused again. */
    REJECTED_BY_CHANNEL(false),
    /**
     * Reserved by the audit in {@code docs/cafe24_review_comment_execution_v1.md}: the value the
     * adapter would refuse with if the comment {@code password} turned out to be a seller secret with
     * no legitimate source (outcome C). The audit settled on outcome A, so no production path emits it;
     * a test pins that.
     */
    BLOCKED_BY_PASSWORD_SOURCE(true),
    /** The channel offers no seller reply flow at all (Coupang reviews): not a switch, a fact about the platform. */
    CHANNEL_UNSUPPORTED(false);

    private final boolean retryable;

    ReviewExecutionReason(boolean retryable) {
        this.retryable = retryable;
    }

    public boolean retryable() {
        return retryable;
    }
}
