package com.sellerops.reviewissue;

import java.util.ArrayList;
import java.util.List;

/**
 * Turns an {@link IssueWindowSnapshot} into the operator-facing change judgements. Pure — no DB, no
 * clock, no LLM — so every threshold boundary is unit-testable, which is the whole point of having
 * fixed the thresholds in a contract first.
 *
 * <p>Deliberately mirrors the structure of the existing {@code AttentionSignalRules.spike}: a
 * minimum current level, a minimum baseline, then a ratio. It differs in using an eight-week mean
 * rather than the single preceding window, because per-issue counts are small and a single previous
 * week is mostly noise — see {@code contracts/review-issue/v1/THRESHOLDS.md} §2.2, including the
 * acknowledged weakness that a past spike inside the baseline can mask a real surge.
 *
 * <p>No judgement here states or implies a cause. "이 이슈의 근거가 이렇게 변했다" is the whole claim.
 */
public final class IssueChangeRules {

    private IssueChangeRules() {
    }

    /**
     * All judgements that fire for this snapshot, in display order (NEW, SURGING, PERSISTENT,
     * CONCENTRATED, IMPROVED). They overlap by design — {@code 증가 중 · 특정 상품 집중} is a normal
     * result — with the single exception that PERSISTENT is suppressed when SURGING fires, because a
     * surge is the more specific statement about the same counts.
     */
    public static Assessment assess(IssueWindowSnapshot s) {
        List<IssueChangeKind> kinds = new ArrayList<>();

        if (isNew(s)) {
            kinds.add(IssueChangeKind.NEW);
        }
        boolean surging = isSurging(s);
        if (surging) {
            kinds.add(IssueChangeKind.SURGING);
        }
        if (!surging && isPersistent(s)) {
            kinds.add(IssueChangeKind.PERSISTENT);
        }
        if (isConcentrated(s)) {
            kinds.add(IssueChangeKind.CONCENTRATED);
        }
        if (isImproved(s)) {
            kinds.add(IssueChangeKind.IMPROVED);
        }
        return new Assessment(List.copyOf(kinds), surging && isHighSurge(s),
                s.surgeWindowCount(), s.surgeBaselineWeekly());
    }

    /**
     * 새로 나타남. Requires that NO evidence predates the window: without that, an old issue
     * returning after a quiet spell would be announced as something the seller has never seen, which
     * is a factual claim and so has to be a fact.
     */
    static boolean isNew(IssueWindowSnapshot s) {
        return !s.hadEvidenceBeforeNewWindow()
                && s.newWindowCount() >= ReviewIssueThresholds.NEW_MIN_EVIDENCE;
    }

    /**
     * 증가 중. All three conditions are load-bearing; in particular the baseline floor is what makes
     * {@code 0 → N} unable to fire, so connecting an account does not alert on every issue at once.
     */
    static boolean isSurging(IssueWindowSnapshot s) {
        if (s.surgeWindowCount() < ReviewIssueThresholds.SURGE_MIN_CURRENT) {
            return false;
        }
        if (s.surgeBaselineTotal() < ReviewIssueThresholds.SURGE_MIN_BASELINE_TOTAL) {
            return false;
        }
        return s.surgeWindowCount() >= s.surgeBaselineWeekly() * ReviewIssueThresholds.SURGE_RATIO;
    }

    /** Whether a firing surge is large enough in both absolute and relative terms to rank above others. */
    static boolean isHighSurge(IssueWindowSnapshot s) {
        return s.surgeWindowCount() >= ReviewIssueThresholds.SURGE_HIGH_CURRENT
                && s.surgeWindowCount() >= s.surgeBaselineWeekly() * ReviewIssueThresholds.SURGE_HIGH_RATIO;
    }

    /** 계속 발생. Four of the last six weeks active — see THRESHOLDS.md §2.3 on why not "6 consecutive". */
    static boolean isPersistent(IssueWindowSnapshot s) {
        return s.activeWeeksInLookback() >= ReviewIssueThresholds.PERSIST_MIN_ACTIVE_WEEKS;
    }

    /**
     * 특정 상품 집중. The minimum total is not a nicety: at one piece of evidence the top product's
     * share is always 1.0, so without it this judgement would be unconditionally true exactly where
     * it has no information.
     */
    static boolean isConcentrated(IssueWindowSnapshot s) {
        return s.concentrationWindowTotal() >= ReviewIssueThresholds.CONCENTRATION_MIN_TOTAL
                && s.concentrationShare() >= ReviewIssueThresholds.CONCENTRATION_SHARE;
    }

    /**
     * 개선됨. Compares weekly means rather than raw totals so the judgement stays correct if the two
     * window lengths in the contract ever diverge.
     */
    static boolean isImproved(IssueWindowSnapshot s) {
        if (s.improveBaselineWeekly() < ReviewIssueThresholds.IMPROVE_MIN_BASELINE_WEEKLY) {
            return false;
        }
        return s.improveCurrentWeekly()
                <= s.improveBaselineWeekly() * ReviewIssueThresholds.IMPROVE_MAX_RATIO;
    }

    /**
     * The judgement result plus the two numbers a surge line needs to be quantified
     * ("최근 7일 9건 · 이전 8주 평균 주 2.1건"). Exposed as structured values so the frontend can
     * render that sentence without parsing prose — the same reason
     * {@code AttentionSignalRules} emits {@code SpikeComparison} alongside its description.
     *
     * @param highSurge false whenever {@link IssueChangeKind#SURGING} did not fire
     */
    public record Assessment(List<IssueChangeKind> kinds, boolean highSurge,
                             long surgeWindowCount, double surgeBaselineWeekly) {

        public boolean has(IssueChangeKind kind) {
            return kinds.contains(kind);
        }

        /** Whether anything fired that should move an OBSERVING issue to NEEDS_REVIEW. */
        public boolean warrantsReview() {
            return kinds.stream().anyMatch(IssueChangeKind::warrantsReview);
        }
    }
}
