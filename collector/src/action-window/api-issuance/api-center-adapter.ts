/**
 * **API-center candidate branch adapter (UNVERIFIED — LIVE_DOM_CALIBRATION_PENDING).**
 *
 * The pure glue between `observe-api-center`'s sanitized page classifier and the issuance state machine. It
 * REUSES that module's classifiers wholesale (`classifyApiCenterPage`, `toSignals`, `countBucket`, the census
 * types) — nothing here re-implements page detection. It adds only:
 *
 *  1. a CANDIDATE existing-vs-empty signal derived from a structural application-entry row count, and
 *  2. the pure branch logic that turns a probe / app-list read into the next issuance stage decision.
 *
 * ⚠ **Everything new here is a HYPOTHESIS, not a proven detector.** Every rule carries the
 * {@link LIVE_DOM_CALIBRATION_PENDING} marker, exactly as `observe-api-center`'s classifier does, so no caller
 * mistakes it for a calibrated selector. The CANDIDATE selector map below is used ONLY by the synthetic
 * fixture driver to find `[data-aw-target]` markers; a selector NEVER crosses the sanitized wire.
 */
import {
  classifyApiCenterPage,
  countBucket,
  toSignals,
  type ApiCenterPageCategory,
  type ApiCenterSignals,
  type ApiCenterStructuralCensus,
  type ApiCenterUrlCategory,
  type CountBucket,
} from "../../cli/observe-api-center";
import type { IssuanceTarget } from "./issuance-driver";

/**
 * The single calibration caveat carried by every rule in this module. Its presence in the output is the
 * promise that these rules are unvalidated hypotheses until a live G3-C walk confirms them — never a claim
 * that a detector is proven.
 */
export const LIVE_DOM_CALIBRATION_PENDING = "LIVE_DOM_CALIBRATION_PENDING" as const;

/**
 * **Whether the issuance highlight driver's control selectors are calibrated against the REAL API center —
 * `true`, SCOPED TO THE NEW-APP PATH.**
 *
 * The LIVE `NaverIssuanceDriver` no longer highlights via {@link CANDIDATE_TARGET_SELECTORS} (those remain ONLY
 * as the synthetic fixture-driver markers, below). It highlights via the calibrated FIXED-LABEL registry in
 * `api-issuance-calibration/issuance-highlight-selectors`. This flag is `true` because the NEW-APP path —
 * `create_app` (애플리케이션 등록), `api_group` (API 그룹), `credentials` (애플리케이션 ID) — is calibrated and
 * LIVE-PROVEN: two READ-ONLY `API_ISSUANCE_SELECTOR_PROBE` runs on the real API center each resolved all three
 * to `matchCount===1` via the driver's own locate mechanism.
 *
 * **`open_app` (the EXISTING-app path) is deliberately OUT OF v1 SCOPE and NOT calibrated.** Opening a specific
 * app depends on its identity (no fixed label); its value-free structural-row anchor measured NON-unique live
 * (44 matches), so it stays a `structural_candidate`. The `isGuidedHighlightTarget` gate makes the guided walk
 * FAIL CLOSED on it (`target_not_found` park) — it never highlights an uncalibrated control. So flipping this
 * flag enables the Phase-B highlight proof for the new-app (create) branch only; an existing-app store parks on
 * `open_app` recoverably. The approval-prerequisite gate reads this to allow `API_ISSUANCE_HIGHLIGHT_PROOF`.
 */
export const SELECTORS_CALIBRATED = true;

/**
 * **CANDIDATE / synthetic fixture markers ONLY.** The `[data-aw-target]` selector the synthetic fixture driver
 * uses to find its markers. The LIVE driver does NOT use these (it uses the calibrated fixed-label registry) —
 * they are DATA counted only by the fixture driver, NEVER emitted on the wire (the wire carries an opaque
 * 16-hex signature, never a selector).
 */
export const CANDIDATE_TARGET_SELECTORS: Readonly<Record<IssuanceTarget, string>> = {
  create_app: "[data-aw-target='create_app']",
  open_app: "[data-aw-target='open_app']",
  api_group: "[data-aw-target='api_group']",
  credentials: "[data-aw-target='credentials']",
  return: "[data-aw-target='return']",
};

/** The population verdict for an applications list. CANDIDATE — derived from a structural row count only. */
export type AppListPopulation = "existing" | "empty";

/**
 * **CANDIDATE / LIVE_DOM_CALIBRATION_PENDING.** Distinguish an applications list that already holds an
 * application from an empty one, from a structural entry-row count — value-free (no application name/id ever).
 *
 * The hypothesis: one or more application-entry rows ⇒ `existing`; none ⇒ `empty`. Bucketized so the rule is
 * coarse (an exact count would be both fragile and needlessly precise).
 */
export function classifyAppListPopulation(applicationEntryRowCount: number): {
  population: AppListPopulation;
  entryRowCountBucket: CountBucket;
  calibration: typeof LIVE_DOM_CALIBRATION_PENDING;
} {
  const entryRowCountBucket = countBucket(applicationEntryRowCount);
  return {
    population: entryRowCountBucket === "none" ? "empty" : "existing",
    entryRowCountBucket,
    calibration: LIVE_DOM_CALIBRATION_PENDING,
  };
}

/** What the engine should do after a surface probe. */
export type ProbeBranch = "login" | "app_list" | "page_mismatch";

/**
 * **CANDIDATE / LIVE_DOM_CALIBRATION_PENDING.** Decide the next issuance stage from a probed page category.
 *
 *  - `login` → the run parks on `waiting_login` (the seller logs in themselves);
 *  - `app_list` → the run reads the applications list and branches existing-vs-empty;
 *  - anything else (`app_detail`, `credential_issuance`, `unknown`, off-target) → the seller is not where the
 *    tutorial expects, so the run parks on `page_mismatch` (fail-closed — a walk never guesses onward from a
 *    page it did not recognise).
 */
export function branchAfterProbe(pageCategory: ApiCenterPageCategory): {
  branch: ProbeBranch;
  calibration: typeof LIVE_DOM_CALIBRATION_PENDING;
} {
  const branch: ProbeBranch = pageCategory === "login" ? "login" : pageCategory === "app_list" ? "app_list" : "page_mismatch";
  return { branch, calibration: LIVE_DOM_CALIBRATION_PENDING };
}

/**
 * Reduce a raw structural census (+ a resolved url category) to the sanitized page category, by delegating to
 * `observe-api-center`'s classifier. Kept here so the issuance side has one call for "census → category" and
 * never re-derives the rules. The classifier already stamps `LIVE_DOM_CALIBRATION_PENDING` on its result.
 */
export function pageCategoryFromCensus(
  urlCategory: ApiCenterUrlCategory,
  census: ApiCenterStructuralCensus,
): { pageCategory: ApiCenterPageCategory; signals: ApiCenterSignals } {
  const signals = toSignals(urlCategory, census);
  const { pageCategory } = classifyApiCenterPage(signals);
  return { pageCategory, signals };
}
