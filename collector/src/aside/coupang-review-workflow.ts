/**
 * **The bound Coupang WING 리뷰 read workflow** — the one route this provider may open, and its version.
 *
 * Tiny on purpose. NAVER's `ExportWorkflow` is a step list because an export is a sequence of seller
 * barriers; a WING read is not. There is one route, one settle, three reads, no step the run chooses between.
 * A vocabulary richer than the work would be the generic browser-automation platform this track refuses to
 * build.
 *
 * **The route is observed, not invented.** `docs/coupang_aside_review_acquisition_poc_v1.md` records the
 * sitting: WING's own navigation anchor (리뷰 목록) resolved to exactly one path, read from the shell under
 * approval `apr-cp-aside-obs-64cdf0` — the same discipline `COUPANG_WING_LOCATE_LANDING_URL` states when it
 * refuses to deep-link to a page nobody has seen. The screen calls it 리뷰; this repository's older constants
 * say 상품평, and the menu word changed under them (measured the same day).
 *
 * Pure: no I/O, no browser, no network.
 */
import { screenWingUrl } from "../cli/coupang-wing-classifier";

export interface CoupangReviewWorkflow {
  readonly id: string;
  readonly version: number;
  /** The official WING review-list route, observed from WING's own menu anchor. */
  readonly entryUrl: string;
  readonly settleTimeoutMs: number;
}

/**
 * The route observed on 2026-09-12. Kept beside the workflow rather than in `local-agent.ts` because it is
 * this workflow's own datum; a changed route surfaces as a fail-closed read, never as a silent wrong page.
 */
export const COUPANG_WING_REVIEW_LIST_URL = "https://wing.coupang.com/tenants/cs/product/review";

export const COUPANG_REVIEW_READ_WORKFLOW: CoupangReviewWorkflow = Object.freeze({
  id: "coupang-wing-review-read",
  version: 1,
  entryUrl: COUPANG_WING_REVIEW_LIST_URL,
  settleTimeoutMs: 30_000,
});

export type CoupangReviewWorkflowError = "ID_INVALID" | "VERSION_INVALID" | "ENTRY_NOT_WING" | "TIMEOUT_INVALID";

/**
 * Validate a workflow before anything opens a tab. The entry URL is screened with the product's OWN WING
 * classifier, so this provider can no more be pointed at a non-WING host than the guided walks can.
 */
export function validateCoupangReviewWorkflow(w: CoupangReviewWorkflow): readonly CoupangReviewWorkflowError[] {
  const errors: CoupangReviewWorkflowError[] = [];
  if (typeof w.id !== "string" || w.id.trim().length === 0) errors.push("ID_INVALID");
  if (!Number.isInteger(w.version) || w.version < 1) errors.push("VERSION_INVALID");
  const screened = screenWingUrl(w.entryUrl);
  if (!screened.ok || screened.urlCategory !== "wing_host") errors.push("ENTRY_NOT_WING");
  if (!Number.isInteger(w.settleTimeoutMs) || w.settleTimeoutMs < 1_000 || w.settleTimeoutMs > 120_000) {
    errors.push("TIMEOUT_INVALID");
  }
  return errors;
}
