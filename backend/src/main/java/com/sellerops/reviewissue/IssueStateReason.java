package com.sellerops.reviewissue;

/**
 * Why a lifecycle transition happened. Stored on {@code review_issue_state_events.reason} so the
 * history answers "why was I told to look at this" months later, when the counts that triggered it
 * have moved on.
 */
public enum IssueStateReason {

    /** The issue row was created by extraction. */
    CREATED,
    /** A change judgement fired. */
    NEW,
    SURGING,
    PERSISTENT,
    CONCENTRATED,
    /** Enough quiet weeks after recorded remediation. */
    QUIET_WEEKS,
    /** The operator moved it. */
    OPERATOR,
    /** New evidence arrived on a RESOLVED issue, so it went back to OBSERVING. */
    REOPENED;

    /** The reason corresponding to a fired judgement. */
    public static IssueStateReason of(IssueChangeKind kind) {
        return switch (kind) {
            case NEW -> NEW;
            case SURGING -> SURGING;
            case PERSISTENT -> PERSISTENT;
            case CONCENTRATED -> CONCENTRATED;
            // IMPROVED never drives a transition — it is report-only, and 개선 확인 중 → 해결됨 is
            // driven by quiet weeks after recorded remediation, not by a declining count.
            case IMPROVED -> throw new IllegalArgumentException(
                    "IMPROVED는 상태 전이를 유발하지 않습니다.");
        };
    }
}
