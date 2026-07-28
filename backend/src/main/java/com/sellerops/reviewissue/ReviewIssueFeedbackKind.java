package com.sellerops.reviewissue;

/**
 * The operator's judgement about a repeated-issue CANDIDATE — offline evaluation signal, never a
 * lifecycle transition and never a claim about the customer.
 *
 * <p>These are the three answers the surface offers to "was this issue useful to see": it is useful
 * ({@code USEFUL}), it is not relevant ({@code NOT_RELEVANT}), or defer it ({@code LATER}). The
 * detector's thresholds are DRAFT and its accuracy is UNMEASURED
 * ({@code contracts/review-issue/v1/THRESHOLDS.md}); this is exactly the kind of honest signal a
 * later eval session reads to find out whether the candidates are the right candidates. It moves no
 * queue and changes no judgement.
 */
public enum ReviewIssueFeedbackKind {
    /** 유용함 — this candidate was worth surfacing. */
    USEFUL,
    /** 관련 없음 — this is not an issue the operator recognises / cares about. */
    NOT_RELEVANT,
    /** 나중에 보기 — defer; neither endorsed nor rejected. */
    LATER;

    /** Parse a client string to a kind, or 400. */
    public static ReviewIssueFeedbackKind parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw com.sellerops.common.ApiException.badRequest("피드백 종류(kind)가 필요합니다.");
        }
        try {
            return valueOf(raw.strip());
        } catch (IllegalArgumentException e) {
            throw com.sellerops.common.ApiException.badRequest("알 수 없는 피드백 종류입니다.");
        }
    }
}
