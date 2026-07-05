package com.sellerops.inquiry.publish;

/**
 * Coarse outcome the API surfaces so the frontend can distinguish the states it must
 * render. Derived from {@link InquiryExecutionStatus} (plus the transient result of
 * the current call for pre-send failures).
 */
public enum PublishOutcomeCategory {
    /** Bound + intent created; not dispatched (execution disabled or awaiting). */
    PENDING,
    /** Dispatch in flight. */
    PUBLISHING,
    /** Terminal success — verified 처리완료. */
    COMPLETED,
    /** Send confirmed or ambiguous; must verify by re-query (no resend). */
    CHECKING_REQUIRED,
    /** Nothing was sent (token/credential/transient) — safe to retry. */
    RETRYABLE_FAILURE,
    /** Provider explicitly rejected the answer — permanent. */
    PERMANENT_FAILURE;

    public static PublishOutcomeCategory fromStatus(InquiryExecutionStatus status) {
        return switch (status) {
            case ACTION_PENDING -> PENDING;
            case DISPATCHING -> PUBLISHING;
            case EXECUTED, DELIVERY_UNKNOWN -> CHECKING_REQUIRED;
            case COMPLETED -> COMPLETED;
            case FAILED -> PERMANENT_FAILURE;
        };
    }
}
