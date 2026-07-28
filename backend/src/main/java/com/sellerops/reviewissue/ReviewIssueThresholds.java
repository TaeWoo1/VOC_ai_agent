package com.sellerops.reviewissue;

/**
 * Every number the change judgements depend on, in ONE place, mirroring
 * {@code contracts/review-issue/v1/THRESHOLDS.md}.
 *
 * <p><b>Why they are here and nowhere else.</b> That contract was written before this code could
 * produce a verdict, for the same reason {@code contracts/review-eval/naver/v1/RUBRIC.md} predates
 * any detector: a threshold agreed after seeing a result is not a threshold. Keeping the numbers in
 * a single class means confirming or revising the draft is a one-line change here plus a version
 * bump there — and it means nobody can tune a judgement by editing a comparison buried in a query.
 *
 * <p>⚠ The contract is currently a <b>DRAFT</b> awaiting product-owner confirmation. These values
 * are the proposal, not a settled decision.
 */
public final class ReviewIssueThresholds {

    /**
     * The contract version these numbers mirror ({@code contracts/review-issue/v1}). Surfaced to the
     * client alongside {@code extractorKind} so a candidate signal can be labelled with the version of
     * the DRAFT thresholds it was judged under — never presented as a settled, versionless fact.
     */
    public static final String CONTRACT_VERSION = "review-issue/v1";

    // ---- Common (THRESHOLDS.md §1) -----------------------------------------------------------
    /**
     * Windows are whole days because {@code reviews.received_at} is date-granular on the file
     * import path: {@code DateParse.localDate} discards the time component and
     * {@code instantAtStartOfDay} pins UTC midnight. An hour-granular window would assume
     * precision the data does not contain.
     */
    public static final int OBSERVATION_WINDOW_DAYS = 7;

    // ---- 신규 등장 (§2.1) ---------------------------------------------------------------------
    /**
     * Longer than the observation window on purpose. At 7 days a genuinely new issue accumulating
     * three mentions across a week boundary would keep resetting and never fire.
     */
    public static final int NEW_WINDOW_DAYS = 14;
    /** One review is not an issue; two co-occur by chance often enough to be noise. */
    public static final int NEW_MIN_EVIDENCE = 3;

    // ---- 급증 (§2.2) --------------------------------------------------------------------------
    public static final int SURGE_WINDOW_DAYS = 7;
    public static final int SURGE_BASELINE_WEEKS = 8;
    public static final long SURGE_MIN_CURRENT = 4;
    /**
     * The counterpart of {@code AttentionSignalRules.SPIKE_MIN_PREVIOUS >= 1}: with no baseline,
     * {@code 0 → N} must never read as a surge, or a freshly connected account alerts on every
     * issue it has. Stated as an 8-week total rather than a per-week floor so a low-frequency issue
     * can still establish one.
     */
    public static final long SURGE_MIN_BASELINE_TOTAL = 4;
    public static final double SURGE_RATIO = 2.0;
    public static final long SURGE_HIGH_CURRENT = 8;
    public static final double SURGE_HIGH_RATIO = 3.5;

    // ---- 계속 발생 (§2.3) ---------------------------------------------------------------------
    public static final int PERSIST_LOOKBACK_WEEKS = 6;
    /**
     * Four of six, not six consecutive. Strict consecutiveness lets one quiet week (a holiday, slow
     * sales, a missed import) erase six weeks of signal, and the operator's question is "is this
     * still happening", not "did it happen every single week".
     */
    public static final int PERSIST_MIN_ACTIVE_WEEKS = 4;

    // ---- 특정 상품 집중 (§2.4) -----------------------------------------------------------------
    /** Structural, not temporal — "which product" needs more samples than "is it rising". */
    public static final int CONCENTRATION_WINDOW_DAYS = 28;
    /**
     * Without a floor this judgement is vacuous in exactly the case it exists for: one piece of
     * evidence makes the top product's share 100%, so "concentrated" becomes unconditionally true.
     * Same class of hole as the one RUBRIC.md §4's third adequacy criterion closed.
     */
    public static final long CONCENTRATION_MIN_TOTAL = 5;
    public static final double CONCENTRATION_SHARE = 0.60;

    // ---- 개선 (§3) ---------------------------------------------------------------------------
    public static final int IMPROVE_WINDOW_WEEKS = 4;
    public static final int IMPROVE_BASELINE_WEEKS = 4;
    /** Below this there was never enough of a problem for a decline to mean anything. */
    public static final double IMPROVE_MIN_BASELINE_WEEKLY = 2.0;
    public static final double IMPROVE_MAX_RATIO = 0.40;

    // ---- 생명주기 (§4) ------------------------------------------------------------------------
    /**
     * Quiet weeks before VERIFYING may become RESOLVED. Only from VERIFYING: an issue that went
     * quiet with no recorded remediation may simply be seeing slow sales, seasonality, or an import
     * gap — none of which is a fix.
     */
    public static final int RESOLVE_QUIET_WEEKS = 4;

    private ReviewIssueThresholds() {
    }

    /** Days covered by the surge baseline, for query construction. */
    public static int surgeBaselineDays() {
        return SURGE_BASELINE_WEEKS * 7;
    }

    /** Days covered by the persistence lookback, for query construction. */
    public static int persistLookbackDays() {
        return PERSIST_LOOKBACK_WEEKS * 7;
    }
}
