package com.sellerops.reviewissue;

/**
 * The four operator-facing change judgements, plus improvement. Deliberately the whole surface
 * vocabulary: internal analysis shape is never exposed, only these.
 *
 * <p>They may overlap — an issue can read {@code 증가 중 · 특정 상품 집중} — with the one exception
 * that {@link #PERSISTENT} is suppressed when {@link #SURGING} fires (a surge is the more specific
 * statement about the same counts).
 *
 * <p>Every threshold lives in {@link ReviewIssueThresholds}, drawn from
 * {@code contracts/review-issue/v1/THRESHOLDS.md}, which was written before this code could
 * produce a verdict — for the same reason the review-eval rubric predates any detector.
 */
public enum IssueChangeKind {

    /** 새로 나타남 — no evidence at all before the window, and enough inside it. */
    NEW("새로 나타남"),
    /** 증가 중 — the current window clearly exceeds a multi-week baseline. */
    SURGING("증가 중"),
    /** 계속 발생 — not surging, but not going away either. */
    PERSISTENT("계속 발생"),
    /** 특정 상품 집중 — one product carries most of the evidence. */
    CONCENTRATED("특정 상품 집중"),
    /**
     * 개선됨 — report-only, never an alert. Good news has no reason to interrupt anyone, and this
     * is the only judgement that shows SellerOps tracks outcomes rather than only raising alarms.
     */
    IMPROVED("개선됨");

    private final String labelKo;

    IssueChangeKind(String labelKo) {
        this.labelKo = labelKo;
    }

    public String labelKo() {
        return labelKo;
    }

    /** Whether firing this judgement should move an OBSERVING issue to NEEDS_REVIEW. */
    public boolean warrantsReview() {
        return this != IMPROVED;
    }
}
