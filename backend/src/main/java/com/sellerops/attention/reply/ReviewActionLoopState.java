package com.sellerops.attention.reply;

/**
 * The Review Issue → Guided Reply action loop's state for ONE review, as a pure projection over the
 * durable records already in this domain (triage disposition · draft head · approval · channel reply
 * state · reported outcome). It is NOT a stored column and mints no new truth — it is computed at read
 * time so the surface renders one honest state instead of re-deriving the rule client-side.
 *
 * <p><b>Honesty fence (product-owner confirmed).</b> {@link #SUBMITTED_VERIFIED} is defined but
 * <b>structurally unreachable for NAVER</b>: there is no read-back oracle, so a recorded outcome's
 * verification is always {@code UNVERIFIED} ({@code VERIFICATION_STATES = ["UNVERIFIED"]}). It is the
 * ONLY state that means "완료"; the live guided-reply terminal is {@link #UNVERIFIED}, which leaves the
 * needs-a-look queue and triggers a best-effort issue-memory refresh but is NEVER shown as 완료
 * (badge 답변함으로 기록·확인 안 함). See {@code docs/slices/review-issue-action-loop-v1.md}.
 *
 * <p><b>{@code GUIDED_SESSION_STARTED} is deliberately absent from this SERVER projection.</b> Minting
 * a single-use {@code submissionRef} changes no durable state — the review is still {@link #APPROVED}
 * with no outcome — so after a restart the honest recovery is exactly {@code APPROVED} (re-mintable).
 * The FE overlays a transient GUIDED_SESSION_STARTED only while a run handle is live in that session.
 */
public enum ReviewActionLoopState {

    /** No draft, no approval, no outcome — the review is not (yet) in the reply loop. */
    NONE,

    /** Triaged 대응 필요 (RESPONSE_NEEDED), no saved draft yet. */
    REVIEW_REQUIRED,

    /** RESPONSE_NEEDED, a draft head exists, not yet approved. */
    DRAFT,

    /** An approval stands, no outcome recorded, and the channel has not answered. */
    APPROVED,

    /**
     * An approval stands but the channel now reports the review as answered — the approved reply is
     * stale and the guided run is withheld (the same start-run 409). The only post-approval
     * invalidation reachable: a draft cannot change while an approval freezes it.
     */
    STALE,

    /**
     * Reserved: the outcome is verification {@code VERIFIED}. Structurally unreachable for NAVER (no
     * oracle). The ONLY state that is "완료".
     */
    SUBMITTED_VERIFIED,

    /**
     * The operator reported posting the approved reply, verification {@code UNVERIFIED} — NAVER's real
     * terminal. Leaves the queue and triggers the best-effort issue-memory refresh; never "완료".
     */
    UNVERIFIED,

    /** The operator reported they did NOT post it ({@code SUBMISSION_ABORTED}). No reply-state change. */
    ABORTED
}
