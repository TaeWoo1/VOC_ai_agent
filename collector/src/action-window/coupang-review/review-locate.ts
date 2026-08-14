/**
 * **`[쿠팡에서 보기]` — finding one stored review on the live WING screen.**
 *
 * The screen carries no per-review identifier (`docs/coupang_review_policy_gate_v1.md` §9.2), so locate cannot
 * ask "which row is review 12345". It has to ask "which row IS this review", and the only honest answer is the
 * one every field agrees on: same product, same day, same score, same body.
 *
 * **The body is compared as a fingerprint**, not as text — `review-body-fingerprint/v1`, which the backend
 * computes identically in Java, so the target a stored review produces and the row the page produces can be
 * compared without the review text ever travelling as a target.
 *
 * **The buyer's name is not an anchor.** It is on the screen and it would make matching easier. It is also the
 * one field on the row that identifies a person, and an anchor is a thing the product would then have to hold
 * to re-find a review later — which is precisely the storage §5d refuses.
 *
 * **One match or nothing.** Zero matches and two matches are both refusals, and neither highlights anything.
 * The failure a loose match produces is not "no ring" — it is a ring around someone else's review, which the
 * seller would read as SellerOps telling them what a buyer said.
 */
import { canonicalizeReviewRow, type CoupangReviewPageReading } from "./review-rows";

/** What locate matches on. Everything here is derivable from a stored review; none of it is a buyer. */
export interface ReviewLocateTarget {
  readonly productId: string;
  /** Compared only when BOTH sides print one — the real screen prints it on some rows and not others. */
  readonly vendorItemId: string | null;
  readonly writtenOn: string;
  readonly rating: number;
  readonly bodyFingerprint: string;
}

export const REVIEW_LOCATE_VERDICTS = [
  "LOCATED",
  "NOT_ON_PAGE",
  "AMBIGUOUS",
  "PAGE_UNREADABLE",
  "INVALID_TARGET",
] as const;
export type ReviewLocateVerdict = (typeof REVIEW_LOCATE_VERDICTS)[number];

/** Counts and a row position. No review text, no ids, nothing about the rows that did not match. */
export interface ReviewLocateOutcome {
  readonly verdict: ReviewLocateVerdict;
  /** The row to highlight — set only on `LOCATED`, so an ambiguous result cannot be highlighted by accident. */
  readonly matchedRowIndex: number | null;
  readonly rowsConsidered: number;
  readonly matches: number;
}

const FINGERPRINT = /^[0-9a-f]{64}$/;

function invalid(target: ReviewLocateTarget): boolean {
  return (
    typeof target?.productId !== "string" ||
    target.productId.length === 0 ||
    typeof target.writtenOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(target.writtenOn) ||
    !Number.isInteger(target.rating) ||
    target.rating < 1 ||
    target.rating > 5 ||
    typeof target.bodyFingerprint !== "string" ||
    !FINGERPRINT.test(target.bodyFingerprint)
  );
}

/**
 * Match a target against one page's reading. A malformed target refuses before looking at the page: a locate
 * that fell through to "compare what is there" would match on fewer fields the emptier the target got, and the
 * emptiest target of all would match every row.
 */
export function locateReviewOnPage(
  reading: CoupangReviewPageReading,
  target: ReviewLocateTarget,
): ReviewLocateOutcome {
  if (invalid(target)) {
    return { verdict: "INVALID_TARGET", matchedRowIndex: null, rowsConsidered: 0, matches: 0 };
  }
  if (reading.reason !== "OK") {
    return { verdict: "PAGE_UNREADABLE", matchedRowIndex: null, rowsConsidered: 0, matches: 0 };
  }

  const matched: number[] = [];
  for (const row of reading.rows) {
    const outcome = canonicalizeReviewRow(row);
    if ("dropReason" in outcome) continue;
    const review = outcome.review;
    if (review.productId !== target.productId) continue;
    if (review.writtenOn !== target.writtenOn) continue;
    if (review.rating !== target.rating) continue;
    if (review.bodyFingerprint !== target.bodyFingerprint) continue;
    // The option id narrows only when both sides have one. Requiring it would refuse every row whose cell
    // prints the product id alone; ignoring it entirely would throw away the one field that separates two
    // options of the same product reviewed identically on the same day.
    if (review.vendorItemId !== null && target.vendorItemId !== null && review.vendorItemId !== target.vendorItemId) {
      continue;
    }
    matched.push(row.rowIndex);
  }

  if (matched.length === 1) {
    return { verdict: "LOCATED", matchedRowIndex: matched[0]!, rowsConsidered: reading.rows.length, matches: 1 };
  }
  return {
    verdict: matched.length === 0 ? "NOT_ON_PAGE" : "AMBIGUOUS",
    matchedRowIndex: null,
    rowsConsidered: reading.rows.length,
    matches: matched.length,
  };
}
