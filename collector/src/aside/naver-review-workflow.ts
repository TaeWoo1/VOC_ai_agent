/**
 * **The bound NAVER Seller Center 리뷰 read workflow** — the one route this recipe may open, and its version.
 *
 * The route is observed, not invented: `#/review/search` is the Seller Center 리뷰 관리 route the guided reply lane
 * has used live since 2026-09-03, and the READ-ONLY discovery of 2026-09-17 opened exactly this URL on the logged-in
 * surface. A changed route surfaces as a fail-closed read (`ROUTE_MISMATCH`), never as a silently different page.
 *
 * Pure: no I/O, no browser, no network.
 */

export interface NaverReviewWorkflow {
  readonly id: string;
  readonly version: number;
  readonly entryUrl: string;
  /** How long the grid may take to fill before the read is refused. */
  readonly settleTimeoutMs: number;
}

export const NAVER_SELLER_CENTER_HOST = "sell.smartstore.naver.com";
export const NAVER_REVIEW_SEARCH_ROUTE = "#/review/search";
export const NAVER_REVIEW_LIST_URL = `https://${NAVER_SELLER_CENTER_HOST}/${NAVER_REVIEW_SEARCH_ROUTE}`;

export const NAVER_REVIEW_READ_WORKFLOW: NaverReviewWorkflow = Object.freeze({
  id: "naver-seller-center-review-read",
  version: 1,
  entryUrl: NAVER_REVIEW_LIST_URL,
  settleTimeoutMs: 45_000,
});

export type NaverReviewWorkflowError = "ID_INVALID" | "VERSION_INVALID" | "ENTRY_NOT_REVIEW_ROUTE" | "TIMEOUT_INVALID";

/**
 * Screen a route by PARSING it, then require it to be exactly the one published route. https only, exactly the
 * Seller Center host, exactly the review search route, and a normalized URL identical to the bound one — which is
 * what refuses userinfo in the authority, a port, a query, or a host that merely contains the name.
 */
export function screenNaverReviewUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    u.hostname.toLowerCase() === NAVER_SELLER_CENTER_HOST &&
    u.hash === NAVER_REVIEW_SEARCH_ROUTE &&
    u.href === NAVER_REVIEW_LIST_URL
  );
}

export function validateNaverReviewWorkflow(w: NaverReviewWorkflow): readonly NaverReviewWorkflowError[] {
  const errors: NaverReviewWorkflowError[] = [];
  if (typeof w.id !== "string" || w.id.trim().length === 0) errors.push("ID_INVALID");
  if (!Number.isInteger(w.version) || w.version < 1) errors.push("VERSION_INVALID");
  if (!screenNaverReviewUrl(w.entryUrl)) errors.push("ENTRY_NOT_REVIEW_ROUTE");
  if (!Number.isInteger(w.settleTimeoutMs) || w.settleTimeoutMs < 1_000 || w.settleTimeoutMs > 90_000) {
    errors.push("TIMEOUT_INVALID");
  }
  return errors;
}
