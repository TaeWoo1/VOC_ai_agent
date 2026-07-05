package com.sellerops.inquiry.publish;

/**
 * Explicit execution state for a seller-confirmed ESM reply. A {@code dispatch_key}
 * is a single-dispatch guard, NOT a guarantee of exactly-once external delivery —
 * {@link #DELIVERY_UNKNOWN} exists precisely because a transport timeout leaves the
 * external outcome ambiguous, and the only safe resolution is to <b>verify by
 * re-query before any retry</b>.
 */
public enum InquiryExecutionStatus {
    /** Bound + intent created; nothing dispatched yet (also the state when live execution is disabled). */
    ACTION_PENDING,
    /** The POST is in flight. */
    DISPATCHING,
    /** The POST returned a provider success (message accepted); verification pending. */
    EXECUTED,
    /** The POST timed out / failed ambiguously; delivery is unknown — verify, never blind-resend. */
    DELIVERY_UNKNOWN,
    /** Verified: the exact inquiry re-queried as 처리완료. Terminal success. */
    COMPLETED,
    /** The provider explicitly rejected the answer. Terminal (permanent) failure. */
    FAILED
}
