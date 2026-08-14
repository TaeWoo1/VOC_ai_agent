/**
 * **The 고객문의 list driver.** One method that matters, and a deliberately short list of what it can do.
 *
 * It exists as its own driver rather than a method on `CoupangWingCredentialDriver` because the two are
 * governed by opposite promises. That driver's whole design is "a value read exists, behind a barrier"; this
 * one's is "no value read exists at all". Putting the inquiry census on the credential driver would put a
 * text-returning terminal one method away from a rows-of-buyer-text page, and the separation is what makes
 * that unreachable rather than merely unused.
 *
 * Nothing here clicks, types, navigates, highlights, tags, or mounts anything. The only thing it does is count.
 */
import type { BrowserContext, Page } from "playwright";
import { log } from "../log";
import { buildInquiryListCensusScript } from "./api-issuance-calibration/inquiry-list-inpage";
import {
  sanitizeInquiryListCensus,
  type InquiryDigitExpectation,
  type InquiryLabelExpectation,
  type InquiryListCensus,
} from "./coupang-wing-inquiry-list";

/** Coupang's own words for the two states, matched whole. Ours to supply, never read off the page. */
export const WING_INQUIRY_STATUS_LABELS: readonly InquiryLabelExpectation[] = Object.freeze([
  { id: "answered", exactText: "답변완료" },
  { id: "unanswered", exactText: "미답변" },
]);

export interface CoupangWingInquiryDriverOptions {
  readonly context?: BrowserContext;
}

const SETTLE_TIMEOUT_MS = 4000;

export class CoupangWingInquiryDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingInquiryDriverOptions;

  constructor(page: Page, opts: CoupangWingInquiryDriverOptions = {}) {
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
      /* a timeout is fine — the census fails closed on a page it cannot read */
    }
  }

  /**
   * **The value-free census.** Counts rows, counts how many carry each identifier we already hold, counts how
   * many say each fixed platform word. Safe to run at any point: there is no terminal here that returns text,
   * so there is nothing for a confirmation to gate beyond the run grant itself.
   */
  async censusInquiryList(
    digits: readonly InquiryDigitExpectation[],
    labels: readonly InquiryLabelExpectation[] = WING_INQUIRY_STATUS_LABELS,
  ): Promise<InquiryListCensus> {
    const page = this.activePage();
    await this.settle(page);
    const raw = await (page as unknown as { evaluate<T>(s: string): Promise<T> })
      .evaluate<unknown>(buildInquiryListCensusScript(digits, labels))
      .catch(() => null);
    const census = sanitizeInquiryListCensus(raw, digits, labels);
    // Counts and our own expectation ids. The log line is the same alphabet as the census itself — if this
    // could print a row, so could the census, and neither may.
    log("aw_coupang_inquiry_census", {
      reason: census.reason,
      containerKind: census.containerKind,
      rowsScanned: census.rowsScanned,
      rowCounts: `${census.rowCounts.table}/${census.rowCounts.list}/${census.rowCounts.grid}`,
      rowsWithDigits: census.rowsWithDigits,
      matches: census.digitMatches.map((m) => `${m.id}=${m.rowMatchCount}`),
      labels: census.labelCounts.map((l) => `${l.id}=${l.rowCount}`),
    });
    return census;
  }
}
