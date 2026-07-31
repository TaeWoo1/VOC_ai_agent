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
 * **CANDIDATE / unverified — calibrate live.** The selector each highlightable control is EXPECTED to carry.
 *
 * These are hypotheses matching the synthetic fixtures' `[data-aw-target]` markers; a live run must confirm
 * the real API-center controls. They are DATA: counted/used only by the synthetic fixture driver, and NEVER
 * emitted on the wire (the wire carries an opaque 16-hex signature, never a selector).
 */
export const CANDIDATE_TARGET_SELECTORS: Readonly<Record<IssuanceTarget, string>> = {
  // CANDIDATE / unverified, calibrate live — none of these is a confirmed API-center control.
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
