package com.sellerops.review.triage;

import com.sellerops.common.ApiException;

/**
 * How urgently one collected review wants the seller's eyes — SellerOps' own suggestion, computed at
 * read time from the review itself.
 *
 * <p><b>A suggestion, not a decision, and not a state.</b> Nothing is stored, nothing is dispatched,
 * and no tier promises that anything will happen next. Deliberately NOT the same thing as
 * {@code com.sellerops.attention.triage.TriageDisposition}, which records what a HUMAN concluded
 * about a review, durably and with an audit trail. The suffixes carry the difference: a disposition
 * is decided, a tier is calculated. Neither reads the other — see
 * {@code docs/slices/review-triage-v1.md} §7.
 *
 * <p><b>Three, because three is what an operator can act on.</b> Finer grades would imply a
 * precision the two inputs behind them ({@link ReviewTriageRules}) do not have.
 *
 * <p>Ordered worst-first, and {@link #ordinal()} is deliberately NOT the sort key — see
 * {@link ReviewTriageRules#rank}, which states the rank explicitly so a future reordering of this
 * enum cannot silently rearrange an operator's worklist.
 */
public enum ReviewTriageTier {

    /** Low-rated, and there is something written to read. The top of the list. */
    NEEDS_ATTENTION,

    /**
     * Worth an eye, nothing to do on its own: a low rating with no text, a middling rating, or a
     * review whose rating is unknown. Unknown is not good news, so it sits here rather than in
     * {@link #FYI}.
     */
    WATCH,

    /** Well-rated. Read it if you like; there is no action in it. */
    FYI;

    /**
     * Parse a client-supplied tier filter; unknown → bad request.
     *
     * <p>Parsed here rather than bound by Jackson as an enum so the caller gets this message instead
     * of a deserialization error naming the Java type — the same reason
     * {@code TriageDisposition.parse} exists.
     */
    public static ReviewTriageTier parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw ApiException.badRequest("확인할 상품평 분류를 지정해 주세요.");
        }
        try {
            return ReviewTriageTier.valueOf(raw.strip());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("알 수 없는 상품평 분류입니다.");
        }
    }
}
