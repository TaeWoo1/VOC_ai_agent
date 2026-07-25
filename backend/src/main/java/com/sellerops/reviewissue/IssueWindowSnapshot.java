package com.sellerops.reviewissue;

/**
 * Everything {@link IssueChangeRules} needs about one issue, already aggregated. Counts only — no
 * review ids, no bodies, no products — so the judgement layer is pure and fully unit-testable, and
 * so a judgement can never accidentally reach customer content.
 *
 * <p>The caller assembles this from {@code review_issue_evidence} with an explicit reference date.
 * The rules never read a clock; a judgement that depended on "now" could not be tested and would
 * silently change meaning between a request and a scheduled report.
 *
 * @param newWindowCount evidence within {@link ReviewIssueThresholds#NEW_WINDOW_DAYS}
 * @param hadEvidenceBeforeNewWindow whether ANY evidence predates that window — the fact that makes
 *     "이전에 없던 문제" a truthful statement rather than a guess about a quiet spell
 * @param surgeWindowCount evidence within {@link ReviewIssueThresholds#SURGE_WINDOW_DAYS}
 * @param surgeBaselineTotal evidence across the {@link ReviewIssueThresholds#SURGE_BASELINE_WEEKS}
 *     weeks immediately preceding the surge window (not overlapping it)
 * @param activeWeeksInLookback weeks with at least one piece of evidence within
 *     {@link ReviewIssueThresholds#PERSIST_LOOKBACK_WEEKS}
 * @param concentrationWindowTotal evidence within
 *     {@link ReviewIssueThresholds#CONCENTRATION_WINDOW_DAYS}
 * @param concentrationTopProductCount evidence in that window attributed to the single most
 *     frequent product; rows with no product must be excluded by the caller, since "unattributed"
 *     is not a product and counting it would let missing data create a concentration
 * @param improveCurrentTotal evidence in the most recent
 *     {@link ReviewIssueThresholds#IMPROVE_WINDOW_WEEKS} weeks
 * @param improveBaselineTotal evidence in the {@link ReviewIssueThresholds#IMPROVE_BASELINE_WEEKS}
 *     weeks immediately preceding that
 */
public record IssueWindowSnapshot(
        long newWindowCount,
        boolean hadEvidenceBeforeNewWindow,
        long surgeWindowCount,
        long surgeBaselineTotal,
        int activeWeeksInLookback,
        long concentrationWindowTotal,
        long concentrationTopProductCount,
        long improveCurrentTotal,
        long improveBaselineTotal) {

    public IssueWindowSnapshot {
        requireNonNegative(newWindowCount, "newWindowCount");
        requireNonNegative(surgeWindowCount, "surgeWindowCount");
        requireNonNegative(surgeBaselineTotal, "surgeBaselineTotal");
        requireNonNegative(activeWeeksInLookback, "activeWeeksInLookback");
        requireNonNegative(concentrationWindowTotal, "concentrationWindowTotal");
        requireNonNegative(concentrationTopProductCount, "concentrationTopProductCount");
        requireNonNegative(improveCurrentTotal, "improveCurrentTotal");
        requireNonNegative(improveBaselineTotal, "improveBaselineTotal");
        if (concentrationTopProductCount > concentrationWindowTotal) {
            // A share above 1.0 is not a bad number to display — it means the caller's two queries
            // disagreed, and every judgement derived from them is untrustworthy. Fail loudly.
            throw new IllegalArgumentException(
                    "최다 상품 근거 수가 전체 근거 수보다 클 수 없습니다.");
        }
        if (activeWeeksInLookback > ReviewIssueThresholds.PERSIST_LOOKBACK_WEEKS) {
            throw new IllegalArgumentException(
                    "활성 주 수가 조회 구간의 주 수를 넘을 수 없습니다.");
        }
    }

    /** Mean weekly evidence over the surge baseline. Zero when the baseline is empty. */
    public double surgeBaselineWeekly() {
        return (double) surgeBaselineTotal / ReviewIssueThresholds.SURGE_BASELINE_WEEKS;
    }

    /** Mean weekly evidence over the improvement baseline. Zero when that baseline is empty. */
    public double improveBaselineWeekly() {
        return (double) improveBaselineTotal / ReviewIssueThresholds.IMPROVE_BASELINE_WEEKS;
    }

    /** Mean weekly evidence over the improvement window. */
    public double improveCurrentWeekly() {
        return (double) improveCurrentTotal / ReviewIssueThresholds.IMPROVE_WINDOW_WEEKS;
    }

    /**
     * Top product's share of the concentration window, or 0 when the window is empty. Callers must
     * still check {@link ReviewIssueThresholds#CONCENTRATION_MIN_TOTAL} — a share computed from one
     * row is 1.0 and means nothing.
     */
    public double concentrationShare() {
        return concentrationWindowTotal == 0
                ? 0.0
                : (double) concentrationTopProductCount / concentrationWindowTotal;
    }

    private static void requireNonNegative(long value, String field) {
        if (value < 0) {
            throw new IllegalArgumentException(field + "는 음수일 수 없습니다.");
        }
    }
}
