/**
 * **The acquisition driver** — the one place review text crosses out of the page, and the one place that must
 * therefore never write it anywhere.
 *
 * The census driver next door (`coupang-wing-review-driver.ts`) is deliberately incapable of returning text.
 * This one is capable by design, so its safety is stated differently: **what it returns goes to the backend,
 * and what it logs is counts.** `record` builds its log line out of the reading's enums and integers only —
 * the same discipline the census log has, held here by choice rather than by inability.
 *
 * It reads the page the operator brought up, and it highlights a row they asked for. It does not turn pages:
 * a pager click is the seller's (root `CLAUDE.md`, "No hidden or chained platform clicks"), and the paging
 * model is the Action Window's — see `review-acquisition.ts`.
 */
import type { BrowserContext, Page } from "playwright";
import { log } from "../../log";
import {
  buildReviewRowAnnotateScript,
  buildReviewRowReadScript,
  REVIEW_TARGET_TEARDOWN,
  type ReviewRowAnchors,
} from "./review-row-inpage";
import { locateReviewOnPage, type ReviewLocateOutcome, type ReviewLocateTarget } from "./review-locate";
import { sanitizeReviewPageReading, type CoupangReviewPageReading } from "./review-rows";

export interface CoupangWingReviewReaderOptions {
  readonly context?: BrowserContext;
  /**
   * Emit the pager DIAGNOSTIC fields when the pager will not resolve — its child shapes, its region labels,
   * its skeleton. Default true, for the acquisition walk, whose completion claim depends on reading a pager
   * it may have to be told about.
   *
   * <p>A locate sets this FALSE. It never uses the pager, and those fields are the only place on this path
   * where arbitrary short strings harvested from the page reach a log — a masked 구매자 cell is exactly the
   * shape that survives the filter. The acquisition takes that risk once per operator press; a locate re-reads
   * every couple of seconds while the seller pages, which would turn a one-off diagnostic into a running dump.
   */
  readonly pagerDiagnostics?: boolean;
}

/** A locate that also says whether the ring actually landed. Never highlighted unless the verdict is LOCATED. */
export interface ReviewLocateResult extends ReviewLocateOutcome {
  readonly highlighted: boolean;
}

const SETTLE_TIMEOUT_MS = 4000;

export class CoupangWingReviewReaderDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingReviewReaderOptions;

  constructor(page: Page, opts: CoupangWingReviewReaderOptions = {}) {
    this.page = page;
    this.opts = opts;
  }

  private activePage(): Page {
    const pages = this.opts.context?.pages() ?? [];
    return pages.length > 0 ? pages[pages.length - 1]! : this.page;
  }

  private async settle(page: Page): Promise<void> {
    const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
    if (typeof p.waitForLoadState !== "function") return;
    try {
      await p.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      /* a timeout is fine — an unreadable page is a named reason, not an exception */
    }
  }

  /** One document's rows. An evaluate that throws becomes `UNREADABLE`, never a page with no reviews on it. */
  async readCurrentPage(on?: Page): Promise<CoupangReviewPageReading> {
    // The caller may pin the page — a locate reads and rings the SAME document, and `activePage()` would
    // otherwise re-resolve to whatever tab is newest at each call.
    const page = on ?? this.activePage();
    await this.settle(page);
    const raw = await (page as unknown as { evaluate<T>(s: string): Promise<T> })
      .evaluate<unknown>(buildReviewRowReadScript())
      .catch(() => null);
    return this.record(sanitizeReviewPageReading(raw));
  }

  /**
   * Find one stored review on the screen and ring it. The match is decided offline from the reading; only a
   * `LOCATED` verdict is allowed to reach the page, and the annotate script re-checks the row itself, so a
   * page that changed between the two steps rings nothing rather than the wrong thing.
   */
  async locate(target: ReviewLocateTarget): Promise<ReviewLocateResult> {
    // ONE page for the read and the ring. `activePage()` re-resolves on every call, so a tab the seller
    // opened in between would be read for the match and then annotated on the other document.
    const page = this.activePage();
    const reading = await this.readCurrentPage(page);
    const outcome = locateReviewOnPage(reading, target);
    if (outcome.verdict !== "LOCATED" || outcome.matchedRowIndex === null) {
      log("aw_coupang_review_locate", { verdict: outcome.verdict, matches: outcome.matches, rows: outcome.rowsConsidered });
      return { ...outcome, highlighted: false };
    }
    const matched = reading.rows.find((r) => r.rowIndex === outcome.matchedRowIndex);
    const highlighted = await this.annotate(
      outcome.matchedRowIndex,
      {
        dateText: matched?.dateText ?? null,
        ratingText: matched?.ratingText ?? null,
        productText: matched?.productText ?? null,
      },
      page,
    );
    log("aw_coupang_review_locate", {
      verdict: highlighted ? outcome.verdict : "NOT_ON_PAGE",
      matches: outcome.matches,
      rows: outcome.rowsConsidered,
      highlighted,
    });
    return highlighted ? { ...outcome, highlighted } : { ...outcome, verdict: "NOT_ON_PAGE", matchedRowIndex: null, highlighted };
  }

  /**
   * Find the FIRST of several stored reviews that this page holds, and ring it.
   *
   * One read, many targets — not one read per target. Reading the page once and matching offline is not an
   * optimisation: a per-target read would compare each target against a *different* reading of a page that can
   * re-render between them, so a run could ring row 3 of a page that no longer looks like the one it matched.
   *
   * A target that is ambiguous on this page is SKIPPED rather than ringing, and the walk continues to the next
   * one — an ambiguous match is a refusal for that review, not for the attempt. The returned outcome is the one
   * belonging to whichever target was rung, or the last refusal when none was.
   */
  async locateAny(targets: readonly ReviewLocateTarget[]): Promise<ReviewLocateResult> {
    const page = this.activePage();
    const reading = await this.readCurrentPage(page);
    let last: ReviewLocateOutcome = { verdict: "NOT_ON_PAGE", matchedRowIndex: null, rowsConsidered: reading.rows.length, matches: 0 };
    for (const target of targets) {
      const outcome = locateReviewOnPage(reading, target);
      last = outcome;
      if (outcome.verdict !== "LOCATED" || outcome.matchedRowIndex === null) continue;
      const matched = reading.rows.find((r) => r.rowIndex === outcome.matchedRowIndex);
      const highlighted = await this.annotate(
        outcome.matchedRowIndex,
        {
          dateText: matched?.dateText ?? null,
          ratingText: matched?.ratingText ?? null,
          productText: matched?.productText ?? null,
        },
        page,
      );
      if (highlighted) {
        log("aw_coupang_review_locate", { verdict: "LOCATED", matches: 1, rows: outcome.rowsConsidered, highlighted: true });
        return { ...outcome, highlighted: true };
      }
      // The row the match named is no longer there — the page changed between the read and the ring. That is
      // NOT_ON_PAGE, not a silent miss, and the next target is not tried against a page that has moved.
      last = { ...outcome, verdict: "NOT_ON_PAGE", matchedRowIndex: null };
      break;
    }
    log("aw_coupang_review_locate", { verdict: last.verdict, matches: last.matches, rows: last.rowsConsidered, highlighted: false });
    return { ...last, highlighted: false };
  }

  private async annotate(rowIndex: number, anchors: ReviewRowAnchors, page: Page): Promise<boolean> {
    const marked = await (page as unknown as { evaluate<T>(s: string): Promise<T> })
      .evaluate<number>(buildReviewRowAnnotateScript(rowIndex, anchors))
      .catch(() => 0);
    return marked === 1;
  }

  /**
   * Take the ring back off — from EVERY page in the context, not just the newest.
   *
   * <p>`activePage()` re-resolves on each call, so a seller who opened a 상품명 in a new tab between the ring
   * and the clear would have had the teardown run on the wrong document: it returns 0, and the ring stays on
   * the list tab for the life of the window. The teardown is idempotent and costs one evaluate per page, so
   * sweeping is simply the version of this that cannot miss.
   */
  async clearHighlight(): Promise<number> {
    const pages = this.opts.context?.pages() ?? [this.page];
    const targets = pages.length > 0 ? pages : [this.page];
    let cleared = 0;
    for (const page of targets) {
      cleared += await (page as unknown as { evaluate<T>(s: string): Promise<T> })
        .evaluate<number>(REVIEW_TARGET_TEARDOWN)
        .catch(() => 0);
    }
    return cleared;
  }

  /**
   * The one log line for a read. Its alphabet is enums and integers — deliberately, because unlike the census
   * this driver HAS the review bodies in hand at this point, and a log is the easiest place for them to end up
   * at rest. `rows` is a count; nothing derived from a row's content appears.
   */
  private record(reading: CoupangReviewPageReading): CoupangReviewPageReading {
    log("aw_coupang_review_read", {
      reason: reading.reason,
      tables: reading.tablesScanned,
      headerWidth: reading.headerWidth,
      roles: reading.rolesResolved.join(","),
      excludedColumns: reading.excludedColumns,
      unmappedColumns: reading.unmappedColumns,
      widthMismatchRows: reading.widthMismatchRows,
      rows: reading.rows.length,
      // The pager, in the same line as the rows. The first live sitting read ten rows perfectly and then
      // stopped on an unresolved pager, and this log said nothing about the pager at all — so the run
      // could not distinguish a screen with no page numbers from one whose current page is marked in a
      // way we do not recognise. Integers and booleans only.
      pager:
        `found=${reading.pager.found}/${reading.pager.resolved} pages=${reading.pager.pageNumbers.length}` +
        ` at=${reading.pager.currentPage ?? "?"} next=${reading.pager.hasNext}/${reading.pager.nextEnabled}` +
        ` clusters=${reading.pager.clustersFound}(+${reading.pager.clustersOfCells} cells)/${reading.pager.clusterSize}` +
        ` marks=${reading.pager.ariaCurrentMarks}/${reading.pager.classMarks}/${reading.pager.nonLinkMarks}`,
      // Only when the pager REFUSED. On a resolved read these add nothing, and a log line that carries the
      // paging region's words on every page of every routine sync is a line that keeps more than it needs to.
      ...(reading.pager.resolved || this.opts.pagerDiagnostics === false
        ? {}
        : {
            pagerShapes: reading.pager.childShapes.join(","),
            pagerLabels: reading.pager.regionLabels.join(","),
            pagerSkeleton: reading.pager.regionSkeleton.join(" "),
          }),
    });
    return reading;
  }
}
