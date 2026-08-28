/**
 * **Scripted acquisition driver — no browser.** Answers each read with the next scripted page reading, so the
 * engine + session can be proven end to end (LOCAL_PROVEN) without WING.
 *
 * The readings it builds are the shape `sanitizeReviewPageReading` produces from a real page; the bodies are
 * obviously synthetic. Nothing here is a marketplace URL, a selector, or a real review.
 */
import type { ReviewAcquisitionProbeDriver } from "./review-acquisition-driver";
import {
  pagerReading,
  type CoupangReviewPageReading,
  type CoupangReviewPagerReading,
  type CoupangReviewRowReading,
} from "./review-rows";

export interface ScriptedPage {
  /** Row bodies on this page. Empty = a readable page with no reviews. */
  readonly bodies?: readonly string[];
  /** Page number the pager shows as current, and the last page number. */
  readonly page?: number;
  readonly last?: number;
  /** Make this read unreadable (not a 상품평 list). */
  readonly unreadable?: boolean;
  /** Make the pager unresolvable on this read. */
  readonly pagerUnresolved?: boolean;
  readonly delayMs?: number;
}

export function fixtureRow(body: string, index: number, rating = "5", date = "2026.08.11"): CoupangReviewRowReading {
  return {
    rowIndex: index,
    dateText: date,
    ratingText: rating,
    ratingAria: null,
    bodyText: body,
    bodyTruncated: false,
    bodyExpandable: false,
    productText: "111222333",
    productNameText: "합성 상품",
    mediaCount: 0,
  };
}

export function fixturePager(current: number, last: number): CoupangReviewPagerReading {
  return pagerReading({
    found: true,
    resolved: true,
    pageNumbers: Array.from({ length: last }, (_, i) => i + 1),
    currentPage: current,
    hasNext: current < last,
    nextEnabled: current < last,
  });
}

export function fixtureReading(page: ScriptedPage): CoupangReviewPageReading {
  const rows = (page.bodies ?? []).map((b, i) => fixtureRow(b, i));
  const pager = page.pagerUnresolved
    ? pagerReading({ found: true, resolved: false, pageNumbers: [], currentPage: null, hasNext: true, nextEnabled: true })
    : fixturePager(page.page ?? 1, page.last ?? 1);
  return {
    reason: page.unreadable ? "HEADERS_UNRESOLVED" : "OK",
    tablesScanned: 1,
    headerWidth: 7,
    excludedColumns: 1,
    unmappedColumns: 1,
    duplicateRoles: 0,
    rolesResolved: ["date", "rating", "product", "productName", "body"],
    widthMismatchRows: 0,
    rows: page.unreadable ? [] : rows,
    pager,
  };
}

export class ReviewAcquisitionFixtureDriver implements ReviewAcquisitionProbeDriver {
  private readonly script: ScriptedPage[];
  private index = 0;
  reads = 0;
  cleanedUp = false;
  raised = 0;
  private closeSurface: (() => void) | null = null;
  private readonly closed: Promise<void>;

  constructor(script: readonly ScriptedPage[] = [{ bodies: ["합성 리뷰 1"], page: 1, last: 1 }]) {
    this.script = script.length > 0 ? [...script] : [{ bodies: [], page: 1, last: 1 }];
    this.closed = new Promise<void>((resolve) => {
      this.closeSurface = resolve;
    });
  }

  /** TEST-ONLY: the seller closed the window. */
  closeWindow(): void {
    this.closeSurface?.();
  }

  async readCurrentPage(): Promise<CoupangReviewPageReading> {
    const page = this.script[Math.min(this.index, this.script.length - 1)]!;
    this.index += 1;
    this.reads += 1;
    if (page.delayMs) await new Promise<void>((r) => setTimeout(r, page.delayMs));
    return fixtureReading(page);
  }

  async cleanup(): Promise<void> {
    this.cleanedUp = true;
  }

  async focusSurface(): Promise<boolean> {
    this.raised += 1;
    return true;
  }

  whenSurfaceClosed(): Promise<void> {
    return this.closed;
  }
}
