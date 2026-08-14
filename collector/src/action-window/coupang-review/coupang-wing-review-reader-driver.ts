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
} from "./review-row-inpage";
import { locateReviewOnPage, type ReviewLocateOutcome, type ReviewLocateTarget } from "./review-locate";
import { sanitizeReviewPageReading, type CoupangReviewPageReading } from "./review-rows";

export interface CoupangWingReviewReaderOptions {
  readonly context?: BrowserContext;
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
  async readCurrentPage(): Promise<CoupangReviewPageReading> {
    const page = this.activePage();
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
    const reading = await this.readCurrentPage();
    const outcome = locateReviewOnPage(reading, target);
    if (outcome.verdict !== "LOCATED" || outcome.matchedRowIndex === null) {
      log("aw_coupang_review_locate", { verdict: outcome.verdict, matches: outcome.matches, rows: outcome.rowsConsidered });
      return { ...outcome, highlighted: false };
    }
    const page = this.activePage();
    const marked = await (page as unknown as { evaluate<T>(s: string): Promise<T> })
      .evaluate<number>(buildReviewRowAnnotateScript(outcome.matchedRowIndex))
      .catch(() => 0);
    const highlighted = marked === 1;
    log("aw_coupang_review_locate", {
      verdict: highlighted ? outcome.verdict : "NOT_ON_PAGE",
      matches: outcome.matches,
      rows: outcome.rowsConsidered,
      highlighted,
    });
    return highlighted ? { ...outcome, highlighted } : { ...outcome, verdict: "NOT_ON_PAGE", matchedRowIndex: null, highlighted };
  }

  /** Take the ring back off. Safe on a page that never had one. */
  async clearHighlight(): Promise<number> {
    const page = this.activePage();
    return await (page as unknown as { evaluate<T>(s: string): Promise<T> })
      .evaluate<number>(REVIEW_TARGET_TEARDOWN)
      .catch(() => 0);
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
    });
    return reading;
  }
}
