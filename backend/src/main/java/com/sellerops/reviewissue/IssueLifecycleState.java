package com.sellerops.reviewissue;

/**
 * An issue's operating state. Stored on {@code review_issues.lifecycle_state}; every transition is
 * additionally appended to {@code review_issue_state_events} so the operator's own 조치 기록 is not
 * lost to an overwrite.
 *
 * <p><b>Only two transitions may be automatic</b> (see
 * {@code contracts/review-issue/v1/THRESHOLDS.md} §4):
 * {@link #OBSERVING} → {@link #NEEDS_REVIEW} when a change judgement fires, and
 * {@link #VERIFYING} → {@link #RESOLVED} after enough quiet weeks. Everything in between is the
 * operator's decision, because SellerOps cannot know that work was done.
 */
public enum IssueLifecycleState {

    /** Evidence exists but nothing has fired. Deliberately not warned about. */
    OBSERVING("관찰 중"),
    /** A change judgement fired; the operator should look. */
    NEEDS_REVIEW("확인 필요"),
    /** The operator started real remediation. */
    ACTING("조치 중"),
    /** Remediation is recorded; SellerOps is watching whether reviews change. */
    VERIFYING("개선 확인 중"),
    /**
     * Quiet for long enough after recorded remediation. <b>Not a claim that the problem is gone</b>
     * — see the wording rule in THRESHOLDS.md §4. New evidence reopens the issue to
     * {@link #OBSERVING} rather than minting a new one.
     */
    RESOLVED("해결됨");

    private final String labelKo;

    IssueLifecycleState(String labelKo) {
        this.labelKo = labelKo;
    }

    /**
     * Operator-facing Korean label. Present on the server because these five words ARE the
     * lifecycle contract — a surface that renamed one would be describing a different state
     * machine. Prose about a state stays in the frontend.
     */
    public String labelKo() {
        return labelKo;
    }

    /** Whether a SYSTEM actor may perform this transition. */
    public boolean systemMayTransitionTo(IssueLifecycleState target) {
        return (this == OBSERVING && target == NEEDS_REVIEW)
                || (this == VERIFYING && target == RESOLVED)
                || (this == RESOLVED && target == OBSERVING);
    }

    /**
     * Whether a SELLER may start remediation from this state (product-owner decision, 2026-09-13).
     *
     * <p><b>{@link #OBSERVING} is here, and that is the decision.</b> Starting work used to require
     * {@link #NEEDS_REVIEW} — so a seller could only act on a problem SellerOps had raised first, and
     * SellerOps raises one only when a change judgement fires. Measured on the demo org, no issue met
     * any threshold at today's date (no 7-day window anywhere held 4 evidence), so 25 of 25 sat in
     * OBSERVING and the decision control was unreachable on every one of them. A seller looking at a
     * problem with 18 occurrences across 3 products can see it is worth fixing whether or not an
     * automatic rule agrees, and a product that refuses to record that is telling them they may only
     * act on problems it noticed.
     *
     * <p><b>What did NOT change: the automatic rules.</b> {@code IssueChangeRules} and
     * {@code ReviewIssueThresholds} are untouched — this widens what a PERSON may say, not what
     * SellerOps concludes. {@link #systemMayTransitionTo} still refuses OBSERVING → ACTING, so the
     * automated pass can no more declare work started than it could before; the two actors' powers
     * sit side by side here precisely so widening one cannot silently widen the other.
     *
     * <p>{@link #RESOLVED} and {@link #VERIFYING} are absent on purpose. Remediation is already
     * recorded in both, and re-entering ACTING from them would overwrite an evidence-backed
     * conclusion with an assertion — the same reason there is no 해결 처리 control anywhere.
     */
    public boolean sellerMayStartActing() {
        return this == OBSERVING || this == NEEDS_REVIEW;
    }
}
