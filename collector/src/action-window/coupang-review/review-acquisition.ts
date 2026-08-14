/**
 * **The acquisition session** — pure, offline, and deliberately not a crawler.
 *
 * ## Why there is no automatic paging here
 *
 * Nothing in this module clicks `다음`. It cannot: a pager click is a marketplace action, and the standing
 * contract (root `CLAUDE.md`, "No hidden or chained platform clicks") reserves those for the seller. So the
 * shape is the Action Window's: **the seller pages, SellerOps reads.** Each page the operator brings up is
 * offered to {@link ReviewAcquisitionSession.offerPage}, which records what is new and reads the pager to
 * decide whether the list has been reached the end of.
 *
 * ## v1 walks to the end of the pager. Both operations.
 *
 * An earlier draft stopped a walk at the first page that brought nothing new, on the reasoning that
 * everything behind it must already be held. **That reasoning is only sound on a newest-first list, and this
 * screen's sort order has never been proven live** — the same screen's four dropdowns already turned out not
 * to be the period filters they looked like (`docs/coupang_review_policy_gate_v1.md` §9.4). On a list sorted
 * any other way, a page of familiar reviews says nothing whatever about the pages behind it, and the walk
 * would stop early while reporting that it had covered everything. That is the worst failure this design can
 * have: silent, and indistinguishable from success.
 *
 * So in v1 a first backfill and a re-sync do the same thing — **read every page the pager offers**. The cost
 * is real (a re-sync asks the operator to page through a list that mostly has not changed) and it is
 * deliberate. The optimisation comes back as a follow-up if and when a live run proves the sort order, and
 * not before.
 *
 * ## Why there is no date range
 *
 * The four dropdowns on the real screen were measured and match neither our period words nor any period shape
 * (§9.4). Asking for a range we have not established would be a guess with a stored-data consequence, so the
 * pager is the only traversal this uses.
 *
 * ## What completion means
 *
 * `complete` is true only when the SCREEN said the walk reached the end — the pager resolved and this page is
 * the last one it offers, or there is no pager and nothing to press — or when the operator declared it
 * finished themselves. A pager that could not be read is `UNKNOWN` and stops the walk without a completion,
 * because "we could not tell" must never round up to "there was no more". The reviews already collected are
 * still handed over (dedupe makes that free and safe); what is withheld is the CLAIM of having seen
 * everything.
 */
import {
  canonicalizeReviewRows,
  localBoundaryKey,
  pagerPosition,
  type CoupangAcquiredReview,
  type CoupangReviewDropCounts,
  type CoupangReviewPageReading,
} from "./review-rows";

/** How the walk ended. Only the first two are completions. */
export const ACQUISITION_STOP_REASONS = [
  /** The pager said this was the last page — or there was no pager and nothing to press. */
  "FINAL_PAGE_REACHED",
  /** The operator said the walk was done. */
  "OPERATOR_FINISHED",
  /** A page could not be read: unresolved headers, an ambiguous table, a row width that disagreed. */
  "PAGE_UNREADABLE",
  /**
   * The pager was there and could not be read — no current page, or a current page it did not also
   * offer. The walk stops rather than continuing blind, because without it there is no reading that
   * could ever end in a completion, and continuing would only accumulate pages under a claim of
   * nothing.
   */
  "PAGER_UNRESOLVED",
  /** The page offered did not advance — same page number, or a row set identical to the one before it. */
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

/**
 * The whole walk. `complete` is the only field that claims anything about coverage, and it is true only
 * when the pager itself said this was the last page.
 */
export interface AcquisitionResult {
  readonly complete: boolean;
  /**
   * The operator said they were done. Deliberately NOT folded into `complete`: a person's recollection of a
   * screen and a pager that showed its last page are different evidence, and a single boolean would let one
   * be read as the other.
   */
  readonly operatorFinished: boolean;
  readonly stopReason: AcquisitionStopReason;
  readonly pagesAccepted: number;
  readonly rowsRead: number;
  /** The pager number of the last accepted page, or null when no page was accepted. */
  readonly lastPageNumber: number | null;
  readonly reviews: readonly CoupangAcquiredReview[];
  readonly dropped: CoupangReviewDropCounts;
  /** Pages that repeated a page already seen — recorded rather than silently tolerated. */
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
  private lastPageNumber: number | null = null;
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

    const position = pagerPosition(reading.pager);
    if (position === "UNKNOWN") {
      // The pager is the ONLY thing that can end this walk in a completion, so a pager that cannot be read
      // ends it here instead of letting pages pile up under a claim that can never be made.
      this.stopped = "PAGER_UNRESOLVED";
      return { pageNumber, accepted: false, rowsRead: 0, newReviews: 0, alreadyKnown: 0, dropped: emptyDrops(), stopReason: this.stopped };
    }

    // **The page NUMBER must move forward.** The row-set signature below catches a page that re-rendered
    // identically; this catches the case it cannot — the operator pressing 이전, or a turn that bounced back
    // — where the rows differ from the last page but the walk is no longer going anywhere.
    const current = reading.pager.currentPage;
    if (current !== null && this.lastPageNumber !== null && current <= this.lastPageNumber) {
      this.repeated += 1;
      this.stopped = "PAGE_DID_NOT_ADVANCE";
      return { pageNumber, accepted: false, rowsRead: reading.rows.length, newReviews: 0, alreadyKnown: 0, dropped: emptyDrops(), stopReason: this.stopped };
    }

    const { reviews, dropped } = canonicalizeReviewRows(reading);
    // A page whose rows ALL dropped (every review on it textless, say) canonicalizes to nothing. That is not a
    // page identity — treating it as one would make two such pages look like a turn that did not turn. Only
    // pages that actually yielded reviews take part in the signature rule.
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
    if (current !== null) this.lastPageNumber = current;

    // **A page brings the walk to an end only when the SCREEN says it is the last one.** Nothing about the
    // reviews on a page decides this — not that they were all familiar, not that none were. A page full of
    // reviews we already hold means the list has been read before; on a list whose sort order has never been
    // proven it says nothing at all about the pages behind it.
    if (position === "FINAL_PAGE") this.stopped = "FINAL_PAGE_REACHED";
    else if (this.accepted >= this.maxPages) this.stopped = "PAGE_LIMIT_REACHED";

    return { pageNumber, accepted: true, rowsRead: reading.rows.length, newReviews: fresh, alreadyKnown: known, dropped, stopReason: this.stopped };
  }

  /**
   * The operator says they are done paging.
   *
   * **This ends the walk; it does not complete it.** An operator's statement that the list is finished is a
   * report, not a reading — the same distinction the Coupang inquiry reply run draws between
   * `OPERATOR_REPORTED` and a verification, and for the same reason: a person answering "yes, that was the
   * last page" is answering from memory of a screen, and a coverage claim that rests on it would be
   * indistinguishable from one the pager confirmed. It is recorded separately as
   * {@link AcquisitionResult.operatorFinished} so nothing can read the two as one fact.
   */
  finish(): void {
    if (this.open) this.stopped = "OPERATOR_FINISHED";
  }

  result(): AcquisitionResult {
    const stopReason = this.stopped;
    return {
      // The ONLY completion. SellerOps saw the last page of the pager, on the screen, itself.
      complete: stopReason === "FINAL_PAGE_REACHED",
      operatorFinished: stopReason === "OPERATOR_FINISHED",
      stopReason,
      pagesAccepted: this.accepted,
      rowsRead: this.rows,
      lastPageNumber: this.lastPageNumber,
      reviews: Object.freeze([...this.collected]),
      dropped: this.drops,
      repeatedPages: this.repeated,
    };
  }
}
