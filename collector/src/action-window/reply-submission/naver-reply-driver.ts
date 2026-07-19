/**
 * **NAVER reply-submission driver CORE (READ-ONLY, ISOLATED).**
 *
 * Drives the guided reply-submission flow over a real page the seller navigated to — locates and
 * highlights the reply composer, arms an observer for the seller's own submit, and reports it. It is
 * the reply-side analogue of `../naver-live-driver.ts` and shares its posture: read-only, sanitized,
 * wired to NO live entrypoint here.
 *
 * HARD BOUNDARIES (enforced by source-guard + privacy tests):
 *  - **No submit, no typing.** The SELLER composes and submits. There is NO `.click(` on the composer
 *    or submit control, NO `.type(`/`.fill(`/`.value =` into the composer, NO `page.keyboard`, and NO
 *    synthetic submit anywhere in this module — it only annotates read-only, observes, and reports.
 *  - **No downstream chain.** It never imports the ingest/upload/quarantine/legacy-capture/export
 *    paths — a reply produces no artifact.
 *  - **Sanitized outputs only.** Counts, booleans, and an OPAQUE 16-hex composer signature. No
 *    selector, URL, path, reply text, or page content ever leaves this module.
 *
 * The in-page snippets are strings (browser JS), so this file is browser-type-free and its boundaries
 * are legible to a source scan. `data-aw-reply-*` annotations are read-only markers; the observer is a
 * plain listener that records a boolean, exactly like the export observer.
 */
import { composerSigFor, replyComposerLocateDecision, reviewRowMatchesHint } from "./reply-surface";
import type { RecencyBucket, ReplyTargetHint } from "./reply-surface";
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import type { ReplyRowMapping } from "./reply-row-mapping-artifact";
import {
  IN_PAGE_ARM_ROW_OBSERVER,
  IN_PAGE_ROW_TEARDOWN,
  inPageAnnotateRow,
  inPageRowCensus,
  inPageRowCount,
} from "./reply-row-inpage";

/** The sanitized per-row census a live row extraction returns — coarse fields or null, never raw text/date. */
interface RawCensusRow {
  rating: number | null;
  recencyBucket: string | null;
  bodyFingerprint: string | null;
}

const RECENCY_BUCKETS: readonly RecencyBucket[] = ["TODAY", "THIS_WEEK", "OLDER"];

/** The minimal, READ-ONLY page surface this driver needs. `evaluate`/`waitForFunction` take strings. */
export interface ReplyPageLike {
  url(): string;
  content(): Promise<string>;
  evaluate<T = unknown>(pageFunction: string): Promise<T>;
  waitForFunction(pageFunction: string, options?: { timeout?: number }): Promise<unknown>;
}

interface ReplySignals {
  loggedIn: boolean;
  composerCandidateCount: number;
  /** A structural, non-reversible integer fingerprint of the single composer (never a selector). */
  structuralFingerprint: number;
}

export interface NaverReplyDriverOptions {
  submitTimeoutMs?: number;
  /** Timeout for observing the operator's own row-open click; defaults to {@link submitTimeoutMs}. */
  rowOpenTimeoutMs?: number;
  /** Privacy-safe match hint (threaded from the bundle). Absent → the guided row seam stays fail-closed. */
  hint?: ReplyTargetHint;
  /** Operator-calibrated relative-DOM mapping. Absent → the guided row seam stays fail-closed (no invented selector). */
  mapping?: ReplyRowMapping;
  /** The KST as-of date (from the bundle) the per-row recency buckets are derived against. */
  asOfDate?: string;
  /**
   * How the target row is located. `"match"` (default) censuses every row and matches on the hint (rating +
   * bucket + body fingerprint). `"calibrated"` trusts the operator-designated `mapping.rowIndex` directly (the
   * row-match abort rehearsal): the operator visually confirms the highlighted row, so no live fingerprint match
   * is required — used when the live body cannot yet be pinned to the backend body (B1 still open).
   */
  locateMode?: "match" | "calibrated";
}

/**
 * Read-only extraction: counts composer candidates and computes a STRUCTURAL integer fingerprint —
 * never returns raw selectors, text, or HTML. A composer is a textarea/contenteditable in a region
 * whose accessible wording matches a reply keyword.
 */
const EXTRACT_SIGNALS = `(() => {
  var kw = ['답변', 'reply', '댓글', 'comment'];
  var nodes = Array.prototype.slice.call(document.querySelectorAll('textarea, [contenteditable="true"]'));
  var candidates = nodes.filter(function (n) {
    var ctx = (n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('placeholder') || '') + ' ' + (n.getAttribute('name') || '');
    ctx = ctx.toLowerCase();
    return kw.some(function (k) { return ctx.indexOf(k.toLowerCase()) >= 0; });
  });
  // Structural fingerprint: a stable integer over the candidate's tag + position, NOT its content.
  var fp = 0;
  if (candidates.length === 1) {
    var el = candidates[0];
    var s = el.tagName + ':' + (el.getAttribute('role') || '') + ':' + nodes.indexOf(el);
    for (var i = 0; i < s.length; i++) { fp = (fp * 31 + s.charCodeAt(i)) | 0; }
    fp = fp >>> 0;
  }
  var loggedIn = !/login|로그인/i.test(document.body ? document.body.getAttribute('data-page') || '' : '');
  return { loggedIn: loggedIn, composerCandidateCount: candidates.length, structuralFingerprint: fp };
})()`;

/** Read-only annotation: mark the single composer for the overlay. NEVER clicks, NEVER types. */
const ANNOTATE = `(() => {
  var kw = ['답변', 'reply', '댓글', 'comment'];
  var nodes = Array.prototype.slice.call(document.querySelectorAll('textarea, [contenteditable="true"]'));
  var candidates = nodes.filter(function (n) {
    var ctx = ((n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('placeholder') || '') + ' ' + (n.getAttribute('name') || '')).toLowerCase();
    return kw.some(function (k) { return ctx.indexOf(k.toLowerCase()) >= 0; });
  });
  if (candidates.length === 1) { candidates[0].setAttribute('data-aw-reply-target', '1'); }
  return candidates.length;
})()`;

/** Arm a plain observer for the seller's own submit — records a boolean, NEVER dispatches anything. */
const ARM_OBSERVER = `(() => {
  window.__awReplyObserved = false;
  document.addEventListener('click', function () { window.__awReplyObserved = true; }, true);
  return true;
})()`;

const TEARDOWN = `(() => {
  var el = document.querySelector('[data-aw-reply-target]');
  if (el) { el.removeAttribute('data-aw-reply-target'); }
  try { delete window.__awReplyObserved; } catch (e) { window.__awReplyObserved = undefined; }
  return true;
})()`;

export class NaverReplySubmitProbeDriver implements ReplySubmitProbeDriver {
  private readonly page: ReplyPageLike;
  private readonly submitTimeoutMs: number;
  private readonly rowOpenTimeoutMs: number;
  private readonly hint?: ReplyTargetHint;
  private readonly mapping?: ReplyRowMapping;
  private readonly asOfDate?: string;
  private readonly locateMode: "match" | "calibrated";

  constructor(page: ReplyPageLike, opts: NaverReplyDriverOptions = {}) {
    this.page = page;
    this.submitTimeoutMs = opts.submitTimeoutMs ?? 600_000;
    this.rowOpenTimeoutMs = opts.rowOpenTimeoutMs ?? this.submitTimeoutMs;
    this.hint = opts.hint;
    this.mapping = opts.mapping;
    this.asOfDate = opts.asOfDate;
    this.locateMode = opts.locateMode ?? "match";
  }

  async prepareSurface(): Promise<SurfaceProbeResult> {
    const signals = await this.page.evaluate<ReplySignals>(EXTRACT_SIGNALS);
    if (!signals.loggedIn) return { ok: false, code: "LOGIN_REQUIRED" };
    return true;
  }

  // ── GUIDED review-row seam — evidence-backed via the operator-calibrated mapping ────────────────
  // The mapping's relative structural paths were captured from the operator's OWN clicks during live
  // calibration (never an invented selector). Each row is censused in-page through those paths — rating,
  // recency bucket (vs the bundle's KST as-of date), and an in-page body fingerprint — and matched against
  // the hint with the SHARED `reviewRowMatchesHint` rule so discovery and this driver can never disagree.
  // With no hint or no mapping the seam stays fail-closed (`{count:0}` → TARGET_NOT_FOUND): no invented selector.

  /** Census every row in the mapped group and apply the shared match rule, tracking the matched DOM index. */
  private async censusDecide(): Promise<{ count: number; sig?: string; matchedRowIndex: number }> {
    if (!this.hint || !this.mapping || !this.asOfDate) return { count: 0, matchedRowIndex: -1 };
    const rows = await this.page.evaluate<RawCensusRow[]>(
      inPageRowCensus(
        {
          parentPath: this.mapping.parentPath,
          rowTag: this.mapping.rowTag,
          ratingPath: this.mapping.ratingPath,
          datePath: this.mapping.datePath,
          bodyPath: this.mapping.bodyPath,
        },
        this.asOfDate,
      ),
    );
    let count = 0;
    let matchedRowIndex = -1;
    rows.forEach((r, i) => {
      if (
        r &&
        typeof r.rating === "number" &&
        typeof r.bodyFingerprint === "string" &&
        typeof r.recencyBucket === "string" &&
        (RECENCY_BUCKETS as readonly string[]).includes(r.recencyBucket) &&
        reviewRowMatchesHint(this.hint!, {
          rating: r.rating,
          recencyBucket: r.recencyBucket as RecencyBucket,
          bodyFingerprint: r.bodyFingerprint,
        })
      ) {
        count += 1;
        matchedRowIndex = i;
      }
    });
    if (count === 1) return { count, sig: composerSigFor(["row", matchedRowIndex]), matchedRowIndex };
    return { count, matchedRowIndex: -1 };
  }

  /** Calibrated locate: trust the operator-designated row index, only confirming the row still exists. */
  private async locateCalibrated(): Promise<{ count: number; sig?: string; matchedRowIndex: number }> {
    if (!this.mapping) return { count: 0, matchedRowIndex: -1 };
    const n = await this.page.evaluate<number>(
      inPageRowCount({ parentPath: this.mapping.parentPath, rowTag: this.mapping.rowTag }),
    );
    const idx = this.mapping.rowIndex;
    if (typeof n !== "number" || idx < 0 || idx >= n) return { count: 0, matchedRowIndex: -1 };
    return { count: 1, sig: composerSigFor(["row", idx]), matchedRowIndex: idx };
  }

  private async locateDecide(): Promise<{ count: number; sig?: string; matchedRowIndex: number }> {
    return this.locateMode === "calibrated" ? this.locateCalibrated() : this.censusDecide();
  }

  async locateReviewRow(): Promise<LocateRowResult> {
    const d = await this.locateDecide();
    return d.sig ? { count: d.count, sig: d.sig } : { count: d.count };
  }

  async highlightRow(): Promise<LocateRowResult> {
    // Anti-drift: re-locate, then annotate the matched row read-only ONLY on a stable unique locate.
    const d = await this.locateDecide();
    if (d.count === 1 && d.sig && this.mapping) {
      await this.page.evaluate(
        inPageAnnotateRow({
          parentPath: this.mapping.parentPath,
          rowTag: this.mapping.rowTag,
          matchedRowIndex: d.matchedRowIndex,
          replyControlPath: this.mapping.replyControlPath,
        }),
      );
      return { count: d.count, sig: d.sig };
    }
    return { count: d.count };
  }

  async armRowObserve(): Promise<void> {
    // Unmapped → fail-closed: never touch the page (the run already fails closed at locate).
    if (!this.hint || !this.mapping) return;
    await this.page.evaluate(IN_PAGE_ARM_ROW_OBSERVER);
  }

  async waitForRowOpen(): Promise<boolean> {
    if (!this.hint || !this.mapping) return false; // unmapped → fail-closed, no wait
    try {
      await this.page.waitForFunction("window.__awReplyRowObserved === true", { timeout: this.rowOpenTimeoutMs });
      return true;
    } catch {
      return false; // timeout — the operator did not open the reply control within the window
    }
  }

  async locateComposer(): Promise<LocateComposerResult> {
    const signals = await this.page.evaluate<ReplySignals>(EXTRACT_SIGNALS);
    return replyComposerLocateDecision({
      composerCandidateCount: signals.composerCandidateCount,
      composerSignatureParts: signals.composerCandidateCount === 1 ? [signals.structuralFingerprint] : undefined,
    });
  }

  async highlight(): Promise<void> {
    await this.page.evaluate(ANNOTATE);
  }

  async armObserve(): Promise<void> {
    await this.page.evaluate(ARM_OBSERVER);
  }

  async waitForSubmit(): Promise<boolean> {
    try {
      await this.page.waitForFunction("window.__awReplyObserved === true", { timeout: this.submitTimeoutMs });
      return true;
    } catch {
      return false; // timeout — the seller did not submit within the window
    }
  }

  async cleanup(): Promise<void> {
    await this.page.evaluate(TEARDOWN).catch(() => undefined);
    await this.page.evaluate(IN_PAGE_ROW_TEARDOWN).catch(() => undefined);
  }
}
