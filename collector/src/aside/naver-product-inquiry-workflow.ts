/**
 * **The bound NAVER Seller Center 상품 문의 read workflow** — the one route this recipe may open, and its version.
 *
 * The route is observed, not invented: the READ-ONLY discovery of 2026-09-17 read it off the Seller Center's own menu
 * («문의 관리» → `#/comment/`) on the logged-in surface and opened exactly this URL. A changed route surfaces as a
 * fail-closed read (`ROUTE_MISMATCH`), never as a silently different page.
 *
 * Pure: no I/O, no browser, no network.
 */
import { NAVER_SELLER_CENTER_HOST } from "./naver-review-workflow";

export interface NaverProductInquiryWorkflow {
  readonly id: string;
  readonly version: number;
  readonly entryUrl: string;
  /** How long the list may take to draw before the read is refused. */
  readonly settleTimeoutMs: number;
}

export const NAVER_PRODUCT_INQUIRY_ROUTE = "#/comment/";
export const NAVER_PRODUCT_INQUIRY_LIST_URL = `https://${NAVER_SELLER_CENTER_HOST}/${NAVER_PRODUCT_INQUIRY_ROUTE}`;

export const NAVER_PRODUCT_INQUIRY_READ_WORKFLOW: NaverProductInquiryWorkflow = Object.freeze({
  id: "naver-seller-center-product-inquiry-read",
  version: 1,
  entryUrl: NAVER_PRODUCT_INQUIRY_LIST_URL,
  settleTimeoutMs: 45_000,
});

export type NaverProductInquiryWorkflowError =
  | "ID_INVALID"
  | "VERSION_INVALID"
  | "ENTRY_NOT_INQUIRY_ROUTE"
  | "TIMEOUT_INVALID";

/**
 * Screen a route by PARSING it, then require it to be exactly the one published route: https only, exactly the Seller
 * Center host, exactly the inquiry route, and a normalized URL identical to the bound one.
 */
export function screenNaverProductInquiryUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    u.hostname.toLowerCase() === NAVER_SELLER_CENTER_HOST &&
    u.hash === NAVER_PRODUCT_INQUIRY_ROUTE &&
    u.href === NAVER_PRODUCT_INQUIRY_LIST_URL
  );
}

export function validateNaverProductInquiryWorkflow(
  w: NaverProductInquiryWorkflow,
): readonly NaverProductInquiryWorkflowError[] {
  const errors: NaverProductInquiryWorkflowError[] = [];
  if (typeof w.id !== "string" || w.id.trim().length === 0) errors.push("ID_INVALID");
  if (!Number.isInteger(w.version) || w.version < 1) errors.push("VERSION_INVALID");
  if (!screenNaverProductInquiryUrl(w.entryUrl)) errors.push("ENTRY_NOT_INQUIRY_ROUTE");
  if (!Number.isInteger(w.settleTimeoutMs) || w.settleTimeoutMs < 1_000 || w.settleTimeoutMs > 90_000) {
    errors.push("TIMEOUT_INVALID");
  }
  return errors;
}
