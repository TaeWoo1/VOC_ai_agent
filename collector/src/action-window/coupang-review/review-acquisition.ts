/**
 * **The acquisition session** — pure, offline, and deliberately not a crawler.
 *
 * ## Why there is no automatic paging here
 *
 * Nothing in this module clicks `다음`. It cannot: a pager click is a marketplace action, and the standing
 * contract (root `CLAUDE.md`, "No hidden or chained platform clicks") reserves those for the seller. So the
 * shape is the Action Window's: **the seller pages, SellerOps reads.** Each page the operator brings up is
 * offered to {@link ReviewAcquisitionSession.offerPage}, which decides what is new and when there is nothing
 * left worth paging for.
 *
 * That is also why routine sync costs the operator nothing: a re-sync reads page 1, finds every review on it
 * already known, and reaches its boundary without a single page turn. Only a first backfill asks for paging,
 * which is exactly the operation a seller expects to sit through once.
 *
 * ## Why there is no date range
 *
 * The four dropdowns on the real screen were measured and match neither our period words nor any period shape
 * (`docs/coupang_review_policy_gate_v1.md` §9.4). Asking for a range we have not established would be a guess
 * with a stored-data consequence, so the pager is the only traversal this uses.
 *
 * ## What completion means
 *
 * `complete` is true only when acquisition reached a **boundary** — a page on which nothing was new — or the
 * operator declared the walk finished. Every other ending, including a page that could not be read and a page
 * that did not change when it should have, leaves `complete` false with a named `stopReason`. The reviews
 * already collected are still handed over (dedupe makes that free and safe); what is withheld is the CLAIM of
 * having seen everything.
 */
import {
  canonicalizeReviewRows,
  localBoundaryKey,
  type CoupangAcquiredReview,
  type CoupangReviewDropCounts,
  type CoupangReviewPageReading,
} from "./review-rows";

/** How the walk ended. Only the first two are completions. */
export const ACQUISITION_STOP_REASONS = [
  /** A page on which every review was already known — there is nothing older worth paging for. */
  "BOUNDARY_REACHED",
  /** The operator said the walk was done. */
  "OPERATOR_FINISHED",
  /** A page could not be read: unresolved headers, an ambiguous table, a row width that disagreed. */
  "PAGE_UNREADABLE",
  /** The page offered was structurally identical to the one before it — a turn that did not turn. */
  "PAGE_DID_NOT_ADVANCE",
  /** The bound on pages was hit first. Says nothing about whether more exist. */
  "PAGE_LIMIT_REACHED",
  /** Still walking. */
  "IN_PROGRESS",
] as const;
export type AcquisitionStopReason = (typeof ACQUISITION_STOP_REASONS)[number];

/** What one offered page contributed. Counts only — no review text, no ids. */
export interface AcquisitionPageOutcome {
  readonly pageNumber: number;
  readonly accepted: boolean;
  readonly rowsRead: number;
  readonly newReviews: number;
  readonly alreadyKnown: number;
  readonly dropped: CoupangReviewDropCounts;
  readonly stopReason: AcquisitionStopReason;
}

/** The whole walk. `complete` is the only field that claims anything about coverage. */
export interface AcquisitionResult {
  readonly complete: boolean;
  readonly stopReason: AcquisitionStopReason;
  readonly pagesAccepted: number;
  readonly rowsRead: number;
  readonly reviews: readonly CoupangAcquiredReview[];
  readonly dropped: CoupangReviewDropCounts;
  /** Pages that repeated a structure already seen — recorded rather than silently tolerated. */
  readonly repeatedPages: number;
}

/** A generous bound. A seller with more 상품평 pages than this backfills across more than one sitting. */
export const MAX_ACQUISITION_PAGES = 100;

function emptyDrops(): CoupangReviewDropCounts {
  return { unparseableDate: 0, unreadableRating: 0, noProductId: 0, noBody: 0 };
}

function addDrops(into: CoupangReviewDropCounts, from: CoupangReviewDropCounts): CoupangReviewDropCounts {
  return {
    unparseableDate: into.unparseableDate + from.unparseableDate,
    unreadableRating: into.unreadableRating + from.unreadableRating,
    noProductId: into.noProductId + from.noProductId,
    noBody: into.noBody + from.noBody,
  };
}

/**
 * The structural identity of a page, from the reviews on it — used only to notice that a page turn did not
 * turn. It is built from boundary keys, so it holds no review text.
 */
function pageSignature(reviews: readonly CoupangAcquiredReview[]): string {
  return reviews.map(localBoundaryKey).join("|");
}

export interface AcquisitionSessionOptions {
  /**
   * Boundary keys acquisition already holds — for a re-sync, everything stored for this connection. An empty
   * set makes the walk a first backfill, which is the only difference between the two operations.
   */
  readonly knownKeys?: Iterable<string>;
  readonly maxPages?: number;
}

export class ReviewAcquisitionSession {
  private readonly known: Set<string>;
  private readonly seenPageSignatures = new Set<string>();
  private readonly collected: CoupangAcquiredReview[] = [];
  private readonly maxPages: number;
  private drops = emptyDrops();
  private accepted = 0;
  private rows = 0;
  private repeated = 0;
  private stopped: AcquisitionStopReason = "IN_PROGRESS";

  constructor(options: AcquisitionSessionOptions = {}) {
    this.known = new Set(options.knownKeys ?? []);
    this.maxPages = Math.max(1, Math.min(MAX_ACQUISITION_PAGES, options.maxPages ?? MAX_ACQUISITION_PAGES));
  }

  /** True while the operator should keep paging. */
  get open(): boolean {
    return this.stopped === "IN_PROGRESS";
  }

  /**
   * Offer one page's reading. Returns what it contributed and whether the walk should continue.
   *
   * A page that cannot be read stops the walk rather than being skipped: skipping it would leave a hole that
   * the next page's successful read would paper over, and the result would claim a coverage it does not have.
   */
  offerPage(reading: CoupangReviewPageReading): AcquisitionPageOutcome {
    const pageNumber = this.accepted + 1;
    if (!this.open) {
      return { pageNumber, accepted: false, rowsRead: 0, newReviews: 0, alreadyKnown: 0, dropped: emptyDrops(), stopReason: this.stopped };
    }
    if (reading.reason !== "OK") {
      this.stopped = "PAGE_UNREADABLE";
      return { pageNumber, accepted: false, rowsRead: 0, newReviews: 0, alreadyKnown: 0, dropped: emptyDrops(), stopReason: this.stopped };
    }

    const { reviews, dropped } = canonicalizeReviewRows(reading);
    // A page whose rows ALL dropped (every review on it textless, say) canonicalizes to nothing. That is not a
    // page identity and it is not a boundary — treating it as either would let a run stop early and call it
    // complete. Only pages that actually yielded reviews take part in both rules below.
    const signature = pageSignature(reviews);
    if (reviews.length > 0 && this.seenPageSignatures.has(signature)) {
      this.repeated += 1;
      this.stopped = "PAGE_DID_NOT_ADVANCE";
      return { pageNumber, accepted: false, rowsRead: reading.rows.length, newReviews: 0, alreadyKnown: reviews.length, dropped, stopReason: this.stopped };
    }
    if (reviews.length > 0) this.seenPageSignatures.add(signature);

    let fresh = 0;
    let known = 0;
    for (const review of reviews) {
      const key = localBoundaryKey(review);
      if (this.known.has(key)) {
        known += 1;
        continue;
      }
      this.known.add(key);
      this.collected.push(review);
      fresh += 1;
    }

    this.accepted += 1;
    this.rows += reading.rows.length;
    this.drops = addDrops(this.drops, dropped);

    // **The boundary is a page with NOTHING new on it** — not a page with something known on it. The stronger
    // rule ("we met a review we already have, so everything behind it is ours") is only sound on a list sorted
    // newest-first, and this screen's sort order has not been established live: the period dropdowns turned out
    // not to be periods (§9.4), which is the standing warning against assuming this list behaves as we picture
    // it. The conservative rule costs one extra page turn on a re-sync where a review arrived since the last
    // one, and never claims a coverage that rests on a guess.
    if (reviews.length > 0 && fresh === 0) this.stopped = "BOUNDARY_REACHED";
    else if (this.accepted >= this.maxPages) this.stopped = "PAGE_LIMIT_REACHED";

    return { pageNumber, accepted: true, rowsRead: reading.rows.length, newReviews: fresh, alreadyKnown: known, dropped, stopReason: this.stopped };
  }

  /** The operator has reached the end of the list themselves. The only other way a walk completes. */
  finish(): void {
    if (this.open) this.stopped = "OPERATOR_FINISHED";
  }

  result(): AcquisitionResult {
    const stopReason = this.stopped;
    return {
      complete: stopReason === "BOUNDARY_REACHED" || stopReason === "OPERATOR_FINISHED",
      stopReason,
      pagesAccepted: this.accepted,
      rowsRead: this.rows,
      reviews: Object.freeze([...this.collected]),
      dropped: this.drops,
      repeatedPages: this.repeated,
    };
  }
}
