/**
 * **NAVER reply driver for the resident (conversation-started) guided run — identity by the review-id ladder.**
 *
 * The seated CLI's `NaverReplySubmitProbeDriver` locates rows through an operator-calibrated structural mapping
 * that only a seated operator can produce. A run started from a conversation has no operator at the keyboard,
 * so this driver locates the exact review the way the review-id probe already does — the in-page ladder over
 * the generic row containers — and accepts a row ONLY when the backend's channel-review-id fingerprint is
 * found on exactly one row (Acceptance Closure §3: hint-only identity is not enough to fill). The rating in the
 * target hint is a secondary check, never the identity.
 *
 * Boundaries, same as the calibrated driver: read-only in-page strings, counts/booleans/opaque sigs out; the
 * one click (`reply-composer-open.ts`) and the one fill (`reply-composer-fill.ts`) live elsewhere and are
 * called by name. The composer is looked for INSIDE the matched row's exclusive scope, never document-wide.
 */
import type { ReplyPageLike } from "./naver-reply-driver";
import type { ComposerFillResult, ReviewIdMatchVerdict } from "./reply-composer-fill";
import type { ComposerFillPageLike } from "./reply-composer-fill";
import { fillComposer, composerFillDecision } from "./reply-composer-fill";
import type { ComposerOpenPageLike, ComposerOpenResult } from "./reply-composer-open";
import { openComposer } from "./reply-composer-open";
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import { composerSigFor, replyComposerLocateDecision } from "./reply-surface";
import type { ReplyTargetHint } from "./reply-surface";
import { civilDateParts, parseLadderResult } from "./review-id-ladder-parse";
import {
  IN_PAGE_ID_OUTLINE_TEARDOWN,
  IN_PAGE_REVIEW_ROW_COUNT,
  IN_PAGE_SCROLL_REVIEW_LIST,
  inPageOutlineRowAt,
  inPageReviewIdLadder,
} from "./review-id-probe-inpage";
import {
  IN_PAGE_ANNOTATE_SCOPED_COMPOSER,
  IN_PAGE_ARM_OPEN_OBSERVER,
  IN_PAGE_LOGIN_SIGNAL,
  IN_PAGE_SCOPED_COMPOSER_SIGNALS,
  IN_PAGE_SCOPED_TEARDOWN,
  IN_PAGE_TAG_OPEN_CONTROL,
} from "./reply-row-composer-inpage";

export type LadderReplyPage = ReplyPageLike & ComposerFillPageLike & ComposerOpenPageLike;

export interface NaverLadderReplyDriverOptions {
  /** The privacy-safe hint (rating is the only part this driver reads, as a secondary check). */
  hint: ReplyTargetHint;
  /** KST as-of civil date the ladder's recency bucket is derived against. */
  asOfDate: string;
  /** SHA-256 of the channel review id the backend holds. Absent ⇒ no row can be proven ⇒ fail closed. */
  reviewIdFingerprint: string | null;
  /** The approved draft, byte for byte; held here for the fill and nowhere else. */
  draftBody: string | null;
  submitTimeoutMs?: number;
  rowOpenTimeoutMs?: number;
  /** How long to watch for a seller-resolvable precondition (a login) before giving up. */
  loginTimeoutMs?: number;
  /**
   * Sanitized run diagnostics. NUMBERS AND VERDICTS ONLY — never a review id, never page text, never the
   * draft. Exists because two live sittings ended with the run gone and no record of what the locate saw:
   * the branch logged nothing, so 「어느 화면을 읽었고 몇 행을 봤는가」 had to be inferred from source, and
   * the first inference was wrong. A locate that fails should say what it looked at.
   */
  onDiagnostic?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  /**
   * Called ONCE after a login is observed, before the surface is re-probed — the carrier's chance to put
   * the page back on the review surface. Read-only by contract: the carrier navigates to the review list
   * it already opened, nothing else. Absent ⇒ the page is re-probed wherever the login left it.
   */
  onSurfaceRecovered?: () => Promise<void>;
}

const ARM_SUBMIT_OBSERVER = `(() => {
  window.__awReplyObserved = false;
  var composer = document.querySelector('[data-aw-reply-target]');
  var scope = composer ? (composer.closest('form') || composer.parentElement || document) : document;
  scope.addEventListener('click', function (ev) {
    var t = ev.target;
    if (composer && t && composer.contains && composer.contains(t)) { return; }
    window.__awReplyObserved = true;
  }, true);
  return true;
})()`;

/** How often the surface wait re-asks the page. Short enough to feel immediate, long enough to be free. */
const SURFACE_POLL_INTERVAL_MS = 700;
/** The floor between two re-landings, so a stubborn page is not navigated in a loop. */
const SURFACE_RELAND_INTERVAL_MS = 6_000;
/**
 * How many consecutive polls must agree on the row count before the list counts as loaded.
 *
 * <b>`rows > 0` is not `rows are all here`</b> (2026-09-03). The seller center paints its review list
 * incrementally: a run that accepted the first non-zero count scanned SEVEN rows — six of them with an
 * unparseable date and three with no channel id at all, the signature of a half-drawn table — while the
 * finished list held twenty-two. Reading a growing list is reading the wrong page slowly.
 */
const SURFACE_STABLE_POLLS = 3;
/**
 * How many screens of the review list one locate may sweep before giving up.
 *
 * The list is lazy: the landing view showed 22 rows while 35 reviews were newer than the target, so the
 * target could not be on the first screen and the seller found it by scrolling. A locate that reads only
 * the first screen can only ever find the newest reviews. Bounded, because an unbounded sweep on someone
 * else's page is not a search, it is a crawl.
 */
const LOCATE_SCROLL_STEPS = 24;
/** Time given to the list to render what a scroll pulled in, before the next scan. */
const LOCATE_SCROLL_SETTLE_MS = 600;

export class NaverLadderReplyDriver implements ReplySubmitProbeDriver {
  private readonly page: LadderReplyPage;
  private readonly hint: ReplyTargetHint;
  private readonly asOfDate: string;
  private readonly reviewIdFingerprint: string | null;
  private readonly draftBody: string | null;
  private readonly submitTimeoutMs: number;
  private readonly rowOpenTimeoutMs: number;
  private readonly loginTimeoutMs: number;
  private readonly onSurfaceRecovered: (() => Promise<void>) | undefined;
  private readonly onDiagnostic: NaverLadderReplyDriverOptions["onDiagnostic"];
  private matchedRowIndex: number | null = null;
  private matchCount = 0;
  private composerCount = 0;

  constructor(page: LadderReplyPage, opts: NaverLadderReplyDriverOptions) {
    this.page = page;
    this.hint = opts.hint;
    this.asOfDate = opts.asOfDate;
    this.reviewIdFingerprint = opts.reviewIdFingerprint && /^[0-9a-f]{64}$/.test(opts.reviewIdFingerprint)
      ? opts.reviewIdFingerprint : null;
    this.draftBody = opts.draftBody;
    this.submitTimeoutMs = opts.submitTimeoutMs ?? 600_000;
    this.rowOpenTimeoutMs = opts.rowOpenTimeoutMs ?? this.submitTimeoutMs;
    this.loginTimeoutMs = opts.loginTimeoutMs ?? this.submitTimeoutMs;
    this.onSurfaceRecovered = opts.onSurfaceRecovered;
    this.onDiagnostic = opts.onDiagnostic;
  }

  private diag(event: string, fields: Record<string, string | number | boolean | null>): void {
    try {
      this.onDiagnostic?.(event, fields);
    } catch {
      // A diagnostic that throws must never be the reason a run ends.
    }
  }

  /** How many review rows the page is showing right now. Read-only; a failure reads as none. */
  private async reviewRowCount(): Promise<number> {
    try {
      const n = await this.page.evaluate<number>(IN_PAGE_REVIEW_ROW_COUNT);
      return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  /**
   * The precondition the engine has always ASSUMED this meant: the seller's review list is on screen.
   *
   * <b>It used to mean「the URL does not say login」</b>, which is a different and much weaker claim. The
   * seller center is a single-page app, so at `domcontentloaded` the shell has rendered and the list has
   * not: measured on 2026-09-03, the ladder ran 441ms after landing, saw `rowsOnPage: 0`, and the run ended
   * as TARGET_NOT_FOUND on a page that was about to show the review the run was looking for.
   *
   * A missing list is reported as `LOGIN_REQUIRED` — the recoverable code — because the two reasons it is
   * missing are both things a wait resolves: the seller has not signed in yet, or the app has not painted
   * yet. {@link waitForSurfaceReady} is what waits; if it gives up, this code is what the seller is told,
   * and 「리뷰 목록을 화면에 띄우지 못했습니다」 is what it will have meant.
   */
  async prepareSurface(): Promise<SurfaceProbeResult> {
    const loggedIn = await this.page.evaluate<boolean>(IN_PAGE_LOGIN_SIGNAL).catch(() => false);
    const rows = loggedIn ? await this.reviewRowCount() : 0;
    this.diag("aw_naver_reply_surface_probe", { loggedIn, rowsOnPage: rows });
    return loggedIn && rows > 0 ? true : { ok: false, code: "LOGIN_REQUIRED" };
  }

  /**
   * Watch — read-only — for the seller to finish signing in, then put the page back on the review surface.
   *
   * <b>Observed 2026-09-03:</b> the dedicated window opened on a login screen, the probe answered
   * `LOGIN_REQUIRED` within milliseconds, and the run went terminal while the seller was still typing. The
   * seller then signed in, reached the review list, and was looking at a live page belonging to a dead run
   * — with no highlight, no guidance and nothing to press. Nothing here logs in, types, or clicks: it polls
   * the same signal {@link prepareSurface} reads, and the recovery hook re-opens the list the carrier had
   * already navigated to.
   */
  async waitForSurfaceReady(): Promise<boolean> {
    const deadline = Date.now() + this.loginTimeoutMs;
    let lastRelandAt = 0;
    let lastCount = -1;
    let stableFor = 0;
    for (;;) {
      const loggedIn = await this.page.evaluate<boolean>(IN_PAGE_LOGIN_SIGNAL).catch(() => false);
      if (loggedIn) {
        const rows = await this.reviewRowCount();
        // SETTLED, not merely non-empty: the same count, several polls running. A list still filling in
        // answers a different number every few hundred milliseconds, and scanning it reads a page that no
        // longer exists by the time the verdict is used.
        stableFor = rows > 0 && rows === lastCount ? stableFor + 1 : 0;
        lastCount = rows;
        if (rows > 0 && stableFor + 1 >= SURFACE_STABLE_POLLS) {
          this.diag("aw_naver_reply_surface_ready", { rowsOnPage: rows, stablePolls: stableFor + 1 });
          return true;
        }
        // Signed in with no list in front of us: the login flow lands wherever NAVER decides, and it is
        // usually not the review page. Re-open it — THROTTLED, because a navigation loop on the seller's
        // own window is worse than waiting. Never while `loggedIn` is false: that is the seller's sign-in
        // form, and navigating away from it would throw away what they were typing.
        if (rows === 0 && this.onSurfaceRecovered && Date.now() - lastRelandAt >= SURFACE_RELAND_INTERVAL_MS) {
          lastRelandAt = Date.now();
          await this.onSurfaceRecovered().catch(() => undefined);
        }
      } else {
        lastCount = -1;
        stableFor = 0;
      }
      if (Date.now() >= deadline) {
        this.diag("aw_naver_reply_surface_timeout", { loggedIn, rowsOnPage: lastCount });
        return false;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, SURFACE_POLL_INTERVAL_MS));
    }
  }



  /** The ladder: rows carrying the backend's review-id fingerprint. Exactly one, or nothing. */
  private async ladder(): Promise<{ count: number; rowIndex: number | null; truncated: boolean }> {
    if (!this.reviewIdFingerprint) return { count: 0, rowIndex: null, truncated: false };
    const parts = civilDateParts(this.asOfDate);
    if (!parts) return { count: 0, rowIndex: null, truncated: false };
    const raw = await this.page.evaluate<unknown>(inPageReviewIdLadder(parts));
    const parsed = parseLadderResult(raw);
    const hits = parsed.candidates.filter((c) => c.idFingerprints.some((f) => f.fingerprint === this.reviewIdFingerprint));
    // Secondary: when the row offers a single rating reading it must agree with the hint. A row that offers
    // none is not contradicted — the identity is the fingerprint, the rating only refuses a contradiction.
    const consistent = hits.filter((c) => (c.secondary?.rating ?? null) === null || c.secondary?.rating === this.hint.rating);
    // What the scan actually saw, in numbers: how many review rows were on the page at all, how many
    // carried the backend's review-id fingerprint, and how many of those survived the rating check. A run
    // that ends here can now say WHICH of those three was zero.
    // When `fingerprintHits` is 0 there are two very different reasons and the run has to be able to tell
    // them apart: the target is not among the rows CURRENTLY on screen (a range question), or the rows carry
    // no channel ids at all (a DOM question). `rowsWithAnyId` separates them, and the recency spread says
    // which slice of the seller's history is being shown. Buckets and counts only — no dates, no ids, no text.
    const buckets: Record<string, number> = {};
    for (const c of parsed.candidates) {
      const b = c.secondary?.recencyBucket ?? "UNKNOWN";
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    this.diag("aw_naver_reply_ladder", {
      rowsOnPage: parsed.candidates.length,
      rowsWithAnyId: parsed.candidates.filter((c) => c.idFingerprints.length > 0).length,
      fingerprintHits: hits.length,
      ratingConsistent: consistent.length,
      recencySpread: Object.entries(buckets).map(([k, v]) => `${k}:${v}`).join(","),
      rowsTruncated: parsed.rowsTruncated,
      tokensTruncated: parsed.tokensTruncated,
    });
    return {
      count: consistent.length,
      rowIndex: consistent.length === 1 ? consistent[0]!.rowIndex : null,
      truncated: parsed.rowsTruncated || parsed.tokensTruncated,
    };
  }

  /** One screen down the review list. Read-only: it moves the viewport, it presses nothing. */
  private async scrollListOnce(): Promise<{ rowCount: number; moved: boolean; atBottom: boolean }> {
    try {
      const r = await this.page.evaluate<{ rowCount: number; moved: boolean; atBottom: boolean }>(
        IN_PAGE_SCROLL_REVIEW_LIST,
      );
      return { rowCount: Number(r?.rowCount ?? 0), moved: !!r?.moved, atBottom: !!r?.atBottom };
    } catch {
      return { rowCount: 0, moved: false, atBottom: true };
    }
  }

  async locateReviewRow(): Promise<LocateRowResult> {
    let d = await this.ladder();
    // The target is not always on the first screen — usually it is not. Sweep DOWN, one screen at a time,
    // re-scanning after each: the list renders lazily, so rows the first scan could not see appear as the
    // viewport moves. Stops the moment the row is found (so nothing scrolls out from under the match that
    // highlight/open/fill are about to use), at the bottom, or at the step cap.
    for (let step = 0; d.count === 0 && step < LOCATE_SCROLL_STEPS; step++) {
      const s = await this.scrollListOnce();
      if (!s.moved) break;
      await new Promise<void>((resolve) => setTimeout(resolve, LOCATE_SCROLL_SETTLE_MS));
      d = await this.ladder();
      this.diag("aw_naver_reply_locate_sweep", {
        step: step + 1, rowsOnPage: s.rowCount, matches: d.count, atBottom: s.atBottom,
      });
      if (d.count > 0 || s.atBottom) break;
    }
    this.matchCount = d.count;
    this.matchedRowIndex = d.rowIndex;
    // A truncated scan that found nothing is "not established", which the engine reads as not found; a
    // truncated scan that found exactly one is still exactly one on what was seen — accepted, like the probe.
    if (d.count === 1 && d.rowIndex !== null) return { count: 1, sig: composerSigFor(["ladder-row", d.rowIndex]) };
    return { count: d.count };
  }

  async highlightRow(): Promise<LocateRowResult> {
    const d = await this.ladder();
    if (d.count !== 1 || d.rowIndex === null || d.rowIndex !== this.matchedRowIndex || !this.reviewIdFingerprint) {
      this.matchedRowIndex = null;
      return { count: d.count };
    }
    const outcome = await this.page.evaluate<string>(inPageOutlineRowAt(d.rowIndex, this.reviewIdFingerprint));
    if (outcome !== "outlined") {
      this.matchedRowIndex = null;
      return { count: 0 };
    }
    return { count: 1, sig: composerSigFor(["ladder-row", d.rowIndex]) };
  }

  /** The Agent's own press on the row's NON-SUBMIT open control. Ambiguity ⇒ the seller is asked instead. */
  async openComposer(): Promise<ComposerOpenResult> {
    if (this.matchedRowIndex === null) return { opened: false, reason: "NOT_FOUND" };
    const tagged = await this.page.evaluate<number>(IN_PAGE_TAG_OPEN_CONTROL);
    if (tagged === 0) {
      // Nothing to press: either the composer is already showing in this row's scope or no open word exists.
      const signals = await this.page.evaluate<{ composerCandidateCount: number }>(IN_PAGE_SCOPED_COMPOSER_SIGNALS);
      return signals.composerCandidateCount === 1 ? { opened: true } : { opened: false, reason: "NOT_FOUND" };
    }
    if (tagged !== 1) return { opened: false, reason: tagged > 1 ? "AMBIGUOUS" : "NOT_FOUND" };
    return openComposer(this.page);
  }

  async armRowObserve(): Promise<void> {
    if (this.matchedRowIndex === null) return;
    await this.page.evaluate(IN_PAGE_TAG_OPEN_CONTROL).catch(() => undefined);
    await this.page.evaluate(IN_PAGE_ARM_OPEN_OBSERVER);
  }

  async waitForRowOpen(): Promise<boolean> {
    if (this.matchedRowIndex === null) return false;
    try {
      await this.page.waitForFunction("window.__awReplyRowObserved === true", { timeout: this.rowOpenTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /** Composers INSIDE the matched row's scope only. */
  async locateComposer(): Promise<LocateComposerResult> {
    if (this.matchedRowIndex === null) return { count: 0 };
    const signals = await this.page.evaluate<{ composerCandidateCount: number; structuralFingerprint: number }>(
      IN_PAGE_SCOPED_COMPOSER_SIGNALS,
    );
    this.composerCount = signals.composerCandidateCount;
    return replyComposerLocateDecision({
      composerCandidateCount: signals.composerCandidateCount,
      composerSignatureParts: signals.composerCandidateCount === 1 ? [signals.structuralFingerprint] : undefined,
    });
  }

  async highlight(): Promise<void> {
    if (this.matchedRowIndex === null) return;
    this.composerCount = await this.page.evaluate<number>(IN_PAGE_ANNOTATE_SCOPED_COMPOSER);
  }

  /** What the ladder established about the review id — MATCHED only on exactly one verified row. */
  reviewIdVerdict(): ReviewIdMatchVerdict {
    if (!this.reviewIdFingerprint) return { kind: "UNAVAILABLE" };
    if (this.matchCount === 1 && this.matchedRowIndex !== null) return { kind: "MATCHED", rowIndex: this.matchedRowIndex };
    return { kind: "AMBIGUOUS", matchCount: this.matchCount };
  }

  async fillComposer(): Promise<ComposerFillResult> {
    const decision = composerFillDecision({
      rowMatchCount: this.matchCount,
      matchedRowIndex: this.matchedRowIndex,
      reviewId: this.reviewIdVerdict(),
      composerCount: this.composerCount,
      hasDraft: this.draftBody != null && this.draftBody.length > 0,
    });
    if (!decision.fill) return { filled: false, reason: decision.reason };
    return fillComposer(this.page, this.draftBody!);
  }

  async armObserve(): Promise<void> {
    await this.page.evaluate(ARM_SUBMIT_OBSERVER);
  }

  async waitForSubmit(): Promise<boolean> {
    try {
      await this.page.waitForFunction("window.__awReplyObserved === true", { timeout: this.submitTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async cleanup(): Promise<void> {
    await this.page.evaluate(IN_PAGE_SCOPED_TEARDOWN).catch(() => undefined);
    await this.page.evaluate(IN_PAGE_ID_OUTLINE_TEARDOWN).catch(() => undefined);
  }
}
