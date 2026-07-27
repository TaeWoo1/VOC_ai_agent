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
}
