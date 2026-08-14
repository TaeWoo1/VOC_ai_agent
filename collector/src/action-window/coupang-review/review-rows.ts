/**
 * **The offline half of Coupang WING 상품평 acquisition** — sanitize what the page returned, then canonicalize
 * it into the record acquisition actually stores.
 *
 * Two jobs, deliberately in one place and none of it in the browser: parsing a date, a rating and an id pair is
 * exactly the kind of rule that gets written twice and drifts, and in-page code is the half that cannot be unit
 * tested. The page reads; this decides what any of it means.
 *
 * **The buyer has no field here.** Not "is dropped here" — has none. {@link CoupangAcquiredReview} carries no
 * author, and neither does the reading type it is built from, so there is no assignment for a careless edit to
 * add. `excludedColumns` carries the COUNT of buyer columns the page found, which is what lets a regression
 * assert the column was located and its text still never appears.
 *
 * **A row that cannot be canonicalized is dropped and counted, never guessed.** An unparseable date, an
 * unreadable rating, a product cell with no id, and a body with no text each drop the row into a named
 * counter. The last one is a real product gap, not a defect — see {@link CoupangAcquiredReview}.
 */
import { reviewBodyFingerprint } from "../reply-submission/review-body-fingerprint";

/** Why a page reading ended as it did. Everything but `OK` means acquisition takes nothing from this page. */
export const REVIEW_READ_REASONS = [
  "OK",
  "NO_ROWS",
  "HEADERS_UNRESOLVED",
  "AMBIGUOUS_TABLE",
  "ROW_WIDTH_MISMATCH",
  "UNREADABLE",
] as const;
export type ReviewReadReason = (typeof REVIEW_READ_REASONS)[number];

/** One row exactly as the page printed it, normalized only for whitespace. No author field exists. */
export interface CoupangReviewRowReading {
  readonly rowIndex: number;
  readonly dateText: string | null;
  readonly ratingText: string | null;
  readonly ratingAria: string | null;
  readonly bodyText: string;
  readonly bodyTruncated: boolean;
  readonly bodyExpandable: boolean;
  readonly productText: string | null;
  readonly productNameText: string | null;
  readonly mediaCount: number;
}

/**
 * What the paging control says — the only thing on the screen that can tell acquisition it reached the end
 * of the list.
 *
 * The three states are deliberately distinct, and the middle one is why this type exists at all:
 *
 * - `found: false, hasNext: false` — there is no pager and nothing to press. The list is one page, and this
 *   page IS the whole list. A small seller's channel is genuinely complete in one read.
 * - `found: true, resolved: false` — a pager is there and which page it is showing could not be identified.
 *   This must never round up to "the end": rounding it up is precisely how a walk comes to claim a coverage
 *   it does not have.
 * - `found: true, resolved: true` — `currentPage` against the highest of `pageNumbers`, plus whether a next
 *   control exists and is pressable. A windowed pager (1…10 while 50 pages exist) leaves its next control
 *   enabled, which is what stops page 10 being read as the last one.
 */
export interface CoupangReviewPagerReading {
  readonly found: boolean;
  readonly resolved: boolean;
  readonly pageNumbers: readonly number[];
  readonly currentPage: number | null;
  readonly hasNext: boolean;
  readonly nextEnabled: boolean;
}

/** One document's reading: the structural verdict plus the rows, if any survived it. */
export interface CoupangReviewPageReading {
  readonly reason: ReviewReadReason;
  readonly tablesScanned: number;
  readonly headerWidth: number;
  /** How many buyer/author columns the header held. Counted so a test can prove one was found and not read. */
  readonly excludedColumns: number;
  readonly unmappedColumns: number;
  readonly duplicateRoles: number;
  readonly rolesResolved: readonly string[];
  readonly widthMismatchRows: number;
  readonly rows: readonly CoupangReviewRowReading[];
  /** Read on every path, including the refusals — a resolved pager over an unreadable table is a finding. */
  readonly pager: CoupangReviewPagerReading;
}

/**
 * One review, canonicalized — the unit acquisition hands to the backend.
 *
 * `body` is the review text as the seller's own screen printed it. `bodyTruncated` says the list cell cut it
 * off; `bodyExpandable` says the cell offered to show more, which is the honest warning that the stored text
 * may be a prefix of what the buyer wrote.
 *
 * **There is no rating-only review here.** Coupang lets a buyer rate without writing, and such a review has no
 * text to tell it apart from another rating-only review of the same product on the same day at the same score.
 * The screen carries no per-review identifier (`docs/coupang_review_policy_gate_v1.md` §9.2), so storing them
 * would silently merge distinct reviews into one. They are dropped and counted instead — a gap that is
 * reported rather than a merge that is not.
 */
export interface CoupangAcquiredReview {
  /** `YYYY-MM-DD`, from the row's own date cell. */
  readonly writtenOn: string;
  readonly rating: number;
  readonly body: string;
  readonly bodyTruncated: boolean;
  readonly bodyExpandable: boolean;
  /** Coupang `노출상품ID` — the catalog identity the review hangs off. */
  readonly productId: string;
  /** Coupang `옵션ID` (`vendorItemId`) when the cell prints one; null when it does not. */
  readonly vendorItemId: string | null;
  readonly productName: string | null;
  readonly mediaCount: number;
  /** `review-body-fingerprint/v1` of `body` — the locate anchor, identical in Java. */
  readonly bodyFingerprint: string;
}

/** Why rows did not survive canonicalization. Each is a count, never a sample of what was dropped. */
export interface CoupangReviewDropCounts {
  readonly unparseableDate: number;
  readonly unreadableRating: number;
  readonly noProductId: number;
  readonly noBody: number;
}

export interface CoupangReviewCanonicalization {
  readonly reviews: readonly CoupangAcquiredReview[];
  readonly dropped: CoupangReviewDropCounts;
}

/** No pager was read at all — distinct from "there is no pager", which is `found: false` from a real read. */
export const UNREAD_PAGER: CoupangReviewPagerReading = Object.freeze({
  found: false,
  resolved: false,
  pageNumbers: Object.freeze([]),
  currentPage: null,
  // `hasNext: true` on an unread pager is the fail-closed default: an acquisition that never saw the
  // control must not conclude there was nothing after this page.
  hasNext: true,
  nextEnabled: true,
});

const EMPTY_READING: CoupangReviewPageReading = Object.freeze({
  reason: "UNREADABLE",
  tablesScanned: 0,
  headerWidth: 0,
  excludedColumns: 0,
  unmappedColumns: 0,
  duplicateRoles: 0,
  rolesResolved: Object.freeze([]),
  widthMismatchRows: 0,
  rows: Object.freeze([]),
  pager: UNREAD_PAGER,
});

const MAX_ROWS = 200;
const MAX_BODY_CHARS = 8000;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function bool(v: unknown): boolean {
  return v === true;
}

/**
 * Fail-closed sanitization of whatever `page.evaluate` returned. A null, a non-object, or an unknown reason
 * becomes `UNREADABLE` with no rows — never a partially-trusted reading, because the caller's next move is to
 * store what this returns.
 */
export function sanitizeReviewPageReading(raw: unknown): CoupangReviewPageReading {
  if (raw === null || typeof raw !== "object") return EMPTY_READING;
  const r = raw as Record<string, unknown>;
  const reason = REVIEW_READ_REASONS.includes(r["reason"] as ReviewReadReason)
    ? (r["reason"] as ReviewReadReason)
    : "UNREADABLE";
  const rawRows = Array.isArray(r["rows"]) ? (r["rows"] as unknown[]).slice(0, MAX_ROWS) : [];
  const rows: CoupangReviewRowReading[] = [];
  for (let i = 0; i < rawRows.length; i += 1) {
    const row = rawRows[i];
    if (row === null || typeof row !== "object") continue;
    const rr = row as Record<string, unknown>;
    const body = str(rr["bodyText"]) ?? "";
    rows.push({
      rowIndex: count(rr["rowIndex"]),
      dateText: str(rr["dateText"]),
      ratingText: str(rr["ratingText"]),
      ratingAria: str(rr["ratingAria"]),
      bodyText: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body,
      bodyTruncated: bool(rr["bodyTruncated"]) || body.length > MAX_BODY_CHARS,
      bodyExpandable: bool(rr["bodyExpandable"]),
      productText: str(rr["productText"]),
      productNameText: str(rr["productNameText"]),
      mediaCount: count(rr["mediaCount"]),
    });
  }
  const pager = sanitizePager(r["pager"]);
  const roles = Array.isArray(r["rolesResolved"])
    ? (r["rolesResolved"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return {
    reason: reason === "OK" && rows.length === 0 ? "NO_ROWS" : reason,
    tablesScanned: count(r["tablesScanned"]),
    headerWidth: count(r["headerWidth"]),
    excludedColumns: count(r["excludedColumns"]),
    unmappedColumns: count(r["unmappedColumns"]),
    duplicateRoles: count(r["duplicateRoles"]),
    rolesResolved: Object.freeze(roles),
    widthMismatchRows: count(r["widthMismatchRows"]),
    rows: Object.freeze(rows),
    pager,
  };
}

const MAX_PAGE_NUMBERS = 200;

/**
 * Sanitize the pager half. A malformed or absent pager becomes {@link UNREAD_PAGER} — never a
 * `found: false, hasNext: false` reading, which the session would correctly treat as "this is a
 * one-page list" and complete on.
 */
function sanitizePager(raw: unknown): CoupangReviewPagerReading {
  if (raw === null || typeof raw !== "object") return UNREAD_PAGER;
  const p = raw as Record<string, unknown>;
  const numbers = Array.isArray(p["pageNumbers"])
    ? (p["pageNumbers"] as unknown[])
        .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
        .slice(0, MAX_PAGE_NUMBERS)
        .sort((a, b) => a - b)
    : [];
  const currentRaw = p["currentPage"];
  const current =
    typeof currentRaw === "number" && Number.isInteger(currentRaw) && currentRaw > 0 ? currentRaw : null;
  const found = p["found"] === true;
  // `resolved` is recomputed rather than trusted: the page said it, and a current page that is not in
  // the numbers it also reported is not a reading anything should act on.
  const resolved = found && current !== null && numbers.includes(current);
  return {
    found,
    resolved,
    pageNumbers: Object.freeze(numbers),
    currentPage: resolved ? current : null,
    hasNext: p["hasNext"] === true,
    nextEnabled: p["hasNext"] === true && p["nextEnabled"] === true,
  };
}

/** Where the pager says this page sits in the list. `UNKNOWN` is the only answer that stops a walk. */
export type PagerPosition = "FINAL_PAGE" | "MORE_PAGES" | "UNKNOWN";

/**
 * Read the pager's position, fail closed.
 *
 * A page is FINAL only when the screen positively says so: either there is no pager and no next control at
 * all (a one-page list), or the pager resolved, this page is the highest number it offers, and its next
 * control is absent or unpressable. Everything else is `MORE_PAGES` or `UNKNOWN`, and neither of those may
 * become a coverage claim.
 */
export function pagerPosition(pager: CoupangReviewPagerReading): PagerPosition {
  if (!pager.found) {
    // No numbered pager. Only a screen that also offers nothing to press is a single-page list; a next
    // control with no numbers beside it means there IS more and we simply cannot count it.
    return pager.hasNext ? "UNKNOWN" : "FINAL_PAGE";
  }
  if (!pager.resolved || pager.currentPage === null) return "UNKNOWN";
  const highest = pager.pageNumbers[pager.pageNumbers.length - 1];
  if (highest === undefined) return "UNKNOWN";
  // A current page the pager does not also offer is a contradiction, not a position. The sanitizer already
  // refuses to mark such a reading resolved; this repeats the check so the function is safe for any caller,
  // because the failure it prevents ("page 9 of 1,2,3" reading as past-the-end) completes a walk.
  if (!pager.pageNumbers.includes(pager.currentPage)) return "UNKNOWN";
  if (pager.currentPage < highest) return "MORE_PAGES";
  // At the highest number the pager PRINTS — which on a windowed pager (1…10 of 50) is not the end. The
  // next control is what tells those two apart, so it decides here rather than the number.
  return pager.nextEnabled ? "MORE_PAGES" : "FINAL_PAGE";
}

/** `2026.08.11` / `2026-8-1` / `2026/08/11 14:03` → `2026-08-11`. Anything else → null; never a guess. */
export function parseReviewDate(text: string | null): string | null {
  if (text === null) return null;
  const m = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(text);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A 1..5 rating from the cell's own text, else from its aria label. `5`, `5.0`, `5점`, `평점 5점` and
 * `5점 만점에 4점` all read; the LAST 1..5 figure wins, because Korean rating labels put the score after the
 * scale. A half star (`4.5`) floors to 4 rather than rounding up — an overstated rating is the direction that
 * hides a complaint.
 */
export function parseReviewRating(text: string | null, aria: string | null): number | null {
  for (const source of [text, aria]) {
    if (source === null) continue;
    const matches = source.match(/[1-5](?:\.\d)?/g);
    if (matches === null || matches.length === 0) continue;
    const value = Number(matches[matches.length - 1]);
    if (Number.isFinite(value) && value >= 1 && value <= 5) return Math.floor(value);
  }
  return null;
}

/**
 * `123456789 (987654321)` → the pair. A cell printing one number gives a product id and no option id; a cell
 * printing none gives neither. The parenthesised half is the option id by Coupang's own header
 * (`노출상품ID (옵션ID)`), so position decides, never magnitude.
 */
export function parseProductIds(text: string | null): { productId: string | null; vendorItemId: string | null } {
  if (text === null) return { productId: null, vendorItemId: null };
  const parenthesised = /\((\d{3,})\)/.exec(text);
  const outside = parenthesised === null ? text : text.replace(parenthesised[0], " ");
  const first = /(\d{3,})/.exec(outside);
  return {
    productId: first === null ? null : first[1]!,
    vendorItemId: parenthesised === null ? null : parenthesised[1]!,
  };
}

/** Which check a row failed. Named so the caller counts a reason rather than merely a loss. */
export type ReviewRowDropReason = keyof CoupangReviewDropCounts;

/**
 * Canonicalize ONE row. Exported because locate needs the row's page POSITION alongside its canonical form,
 * and a second copy of these four checks living in the locate path is how the two would come to disagree
 * about which rows exist.
 */
export function canonicalizeReviewRow(
  row: CoupangReviewRowReading,
): { review: CoupangAcquiredReview } | { dropReason: ReviewRowDropReason } {
  const writtenOn = parseReviewDate(row.dateText);
  if (writtenOn === null) return { dropReason: "unparseableDate" };
  const rating = parseReviewRating(row.ratingText, row.ratingAria);
  if (rating === null) return { dropReason: "unreadableRating" };
  const { productId, vendorItemId } = parseProductIds(row.productText);
  if (productId === null) return { dropReason: "noProductId" };
  const body = row.bodyText.trim();
  if (body.length === 0) return { dropReason: "noBody" };
  return {
    review: {
      writtenOn,
      rating,
      body,
      bodyTruncated: row.bodyTruncated,
      bodyExpandable: row.bodyExpandable,
      productId,
      vendorItemId,
      productName: row.productNameText,
      mediaCount: row.mediaCount,
      bodyFingerprint: reviewBodyFingerprint(body),
    },
  };
}

/**
 * Canonicalize a page reading. A reading whose reason is not `OK` yields nothing — a structural failure is not
 * a partial harvest, and half of a review list is indistinguishable from a whole one once it is stored.
 */
export function canonicalizeReviewRows(reading: CoupangReviewPageReading): CoupangReviewCanonicalization {
  const dropped = { unparseableDate: 0, unreadableRating: 0, noProductId: 0, noBody: 0 };
  if (reading.reason !== "OK") return { reviews: Object.freeze([]), dropped: Object.freeze(dropped) };

  const reviews: CoupangAcquiredReview[] = [];
  for (const row of reading.rows) {
    const outcome = canonicalizeReviewRow(row);
    if ("dropReason" in outcome) {
      dropped[outcome.dropReason] += 1;
      continue;
    }
    reviews.push(outcome.review);
  }
  return { reviews: Object.freeze(reviews), dropped: Object.freeze(dropped) };
}

/**
 * The collector's own boundary key for one acquired review — how the pager walk recognizes a page it has
 * already taken. It is NOT the storage identity: the backend's content hash decides that, and this never
 * leaves the agent. The body reaches it as its fingerprint, so the boundary set holds no review text.
 */
export function localBoundaryKey(review: CoupangAcquiredReview): string {
  const parts = [review.productId, review.vendorItemId ?? "", review.writtenOn, String(review.rating), review.bodyFingerprint];
  return parts.map((p) => `${p.length}:${p}`).join("");
}
