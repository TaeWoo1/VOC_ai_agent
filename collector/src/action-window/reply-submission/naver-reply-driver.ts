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
import { replyComposerLocateDecision } from "./reply-surface";
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";
import type { ReplySubmitProbeDriver } from "./reply-driver";

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

  constructor(page: ReplyPageLike, opts: NaverReplyDriverOptions = {}) {
    this.page = page;
    this.submitTimeoutMs = opts.submitTimeoutMs ?? 600_000;
  }

  async prepareSurface(): Promise<SurfaceProbeResult> {
    const signals = await this.page.evaluate<ReplySignals>(EXTRACT_SIGNALS);
    if (!signals.loggedIn) return { ok: false, code: "LOGIN_REQUIRED" };
    return true;
  }

  // ── GUIDED review-row seam — DELIBERATELY FAIL-CLOSED ──────────────────────────────────────────
  // A real NAVER review-row selector + a live↔redactedBody fingerprint-normalization transform require
  // captured live DOM evidence that does not exist yet (see the offline slice's Risk 1). Rather than
  // GUESS a selector, the live driver reports zero matching rows so a guided live run fails closed
  // (TARGET_NOT_FOUND) and never proceeds. Only the fixture driver actually locates rows offline.
  async locateReviewRow(): Promise<LocateRowResult> {
    return { count: 0 };
  }
  async highlightRow(): Promise<LocateRowResult> {
    return { count: 0 };
  }
  async armRowObserve(): Promise<void> {
    return;
  }
  async waitForRowOpen(): Promise<boolean> {
    return false;
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
  }
}
