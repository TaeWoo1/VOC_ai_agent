import {
  DETAIL_CLOSE_MARK,
  DETAIL_OPEN_MARK,
  buildNaverReviewDetailCloseLocateScript,
  buildNaverReviewDetailLocateScript,
  buildNaverReviewReplyReadScript,
} from "./review-reply-detail-inpage";

/**
 * **NAVER Review Reply Enrichment — the runtime.** For each named review (the export says it was replied to): locate
 * it by its own id in the list model, press its detail-open control, read the one reply from the detail's model,
 * press the detail's close control. Two kinds of press and nothing else — both on an element the page script marked
 * after checking its id and its words; no typing, no key press, no scroll, no navigation, no reply/write control.
 *
 * A hard cap on presses for the whole call ({@link DEFAULT_MAX_CLICKS}); a review that is not in the list's current
 * rows is reported `NOT_RENDERED` and skipped — the seller moves the list, this code never scrolls it.
 */

export const DEFAULT_MAX_CLICKS = 6;

/** The narrow page surface this runtime needs — a Playwright Page satisfies it. */
export interface DetailPage {
  evaluate<T>(script: string): Promise<T>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
}

export interface ReplyObservation {
  readonly sourceReviewId: string;
  readonly replyText: string;
  readonly repliedAt: string | null;
}

export interface EnrichmentStep {
  readonly sourceReviewId: string;
  readonly locate: string;
  readonly read?: string;
  readonly close?: string;
  /** Key names or paths the read reported — never values. */
  readonly structure?: readonly string[];
}

export interface EnrichmentResult {
  readonly observations: readonly ReplyObservation[];
  readonly steps: readonly EnrichmentStep[];
  readonly clicks: number;
}

interface LocateOut { reason: string }
interface ReadOut { reason: string; replyText?: string; repliedAt?: string | null; keys?: string[]; paths?: string[]; textPath?: string | null; datePath?: string | null }

export async function enrichNaverReviewReplies(
  page: DetailPage,
  sourceReviewIds: readonly string[],
  opts: { maxClicks?: number; settleMs?: number; readAttempts?: number } = {},
): Promise<EnrichmentResult> {
  const maxClicks = opts.maxClicks ?? DEFAULT_MAX_CLICKS;
  const settleMs = opts.settleMs ?? 800;
  const attempts = opts.readAttempts ?? 8;
  const observations: ReplyObservation[] = [];
  const steps: EnrichmentStep[] = [];
  let clicks = 0;

  for (const id of sourceReviewIds) {
    // Open and close are two presses; never start a review the budget cannot finish closing.
    if (clicks + 2 > maxClicks) {
      steps.push({ sourceReviewId: id, locate: "CLICK_BUDGET_EXHAUSTED" });
      break;
    }
    const located = await page.evaluate<LocateOut>(buildNaverReviewDetailLocateScript(id));
    if (located.reason !== "OK") {
      steps.push({ sourceReviewId: id, locate: located.reason });
      continue;
    }
    clicks += 1;
    await page.click(`[${DETAIL_OPEN_MARK}="1"]`, { timeout: 5000 });

    let read: ReadOut = { reason: "NO_DETAIL_OPEN" };
    for (let i = 0; i < attempts; i += 1) {
      await page.waitForTimeout(settleMs);
      read = await page.evaluate<ReadOut>(buildNaverReviewReplyReadScript(id));
      if (read.reason !== "NO_DETAIL_OPEN") break;
    }
    if (read.reason === "OK" && read.replyText) {
      observations.push({ sourceReviewId: id, replyText: read.replyText, repliedAt: read.repliedAt ?? null });
    }
    const closeAt = await page.evaluate<LocateOut>(buildNaverReviewDetailCloseLocateScript());
    let closed = closeAt.reason;
    if (closeAt.reason === "OK") {
      clicks += 1;
      await page.click(`[${DETAIL_CLOSE_MARK}="1"]`, { timeout: 5000 });
      await page.waitForTimeout(settleMs);
      closed = "CLOSED";
    }
    steps.push({
      sourceReviewId: id,
      locate: "OK",
      read: read.reason,
      close: closed,
      structure: read.keys ?? read.paths ?? (read.textPath ? [read.textPath, read.datePath ?? ""] : undefined),
    });
    if (closed !== "CLOSED") break; // a detail that will not close is not a page to keep pressing on
  }
  return { observations, steps, clicks };
}
