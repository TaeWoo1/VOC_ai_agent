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
  IN_PAGE_SCROLL_REVIEW_LIST_TOP,
  inPageOutlineRowAt,
  inPageReviewIdLadder,
} from "./review-id-probe-inpage";
import {
  UNREAD_RANGE_CENSUS,
  inPageReviewListRange,
  parseRangeCensus,
  type ReviewListRangeCensus,
} from "./review-list-range-inpage";
import {
  IN_PAGE_ANNOTATE_SCOPED_COMPOSER,
  IN_PAGE_ARM_OPEN_OBSERVER,
  IN_PAGE_LOGIN_SIGNAL,
  IN_PAGE_SCOPED_COMPOSER_SIGNALS,
  IN_PAGE_SCOPED_TEARDOWN,
  IN_PAGE_TAG_OPEN_CONTROL,
  inPageTagDetailControl,
  inPageVerifyDetailScope,
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
   * How long to keep watching after the sweep proves the target is OUTSIDE the period the list is showing —
   * the window in which the seller can widen that period on the page in front of them and have the run
   * continue. `0` disables the wait (the locate then fails as soon as the sweep does).
   */
  rangeWaitMs?: number;
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
/** Time the detail panel is given to render before its identity is checked. */
const DETAIL_SETTLE_MS = 1_200;
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
/** How often the range wait re-asks the page (cheap: one ladder read, no scrolling). */
const RANGE_POLL_INTERVAL_MS = 2_500;
/**
 * How often the range wait re-sweeps the whole list even when nothing looked like it changed.
 *
 * The change signal (the period controls now read a different window) is the normal trigger; this is the
 * floor under it, for the surface that re-queries without its own inputs reporting anything new.
 */
const RANGE_RESWEEP_INTERVAL_MS = 30_000;

/** One ladder read of whatever the list is showing right now: the match, plus what the scan saw. */
interface LadderScan {
  count: number;
  rowIndex: number | null;
  truncated: boolean;
  /** Recency buckets present on the scanned rows, by count — how the run knows WHICH slice it is reading. */
  buckets: Record<string, number>;
  rowsOnPage: number;
}

/**
 * Why a sweep that matched nothing matched nothing — two different facts that were reported as one.
 *
 * `OUT_OF_LISTED_RANGE` says the run reached the END of the list and never saw a single row from the target's
 * own recency bucket: the review is not missing, the screen is not showing that part of the seller's history.
 * `NOT_ON_SURFACE` is the older claim, and now only made when the sweep actually covered the target's slice.
 * `NOT_ESTABLISHED` is a sweep that ran out of steps before the bottom — it proved nothing either way.
 */
export type LocateMissVerdict = "OUT_OF_LISTED_RANGE" | "NOT_ON_SURFACE" | "NOT_ESTABLISHED";

export class NaverLadderReplyDriver implements ReplySubmitProbeDriver {
  private readonly page: LadderReplyPage;
  private readonly hint: ReplyTargetHint;
  private readonly asOfDate: string;
  private readonly reviewIdFingerprint: string | null;
  private readonly draftBody: string | null;
  private readonly submitTimeoutMs: number;
  private readonly rowOpenTimeoutMs: number;
  private readonly loginTimeoutMs: number;
  private readonly rangeWaitMs: number;
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
    this.rangeWaitMs = opts.rangeWaitMs ?? 0;
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
  private async ladder(): Promise<LadderScan> {
    if (!this.reviewIdFingerprint) return { count: 0, rowIndex: null, truncated: false, buckets: {}, rowsOnPage: 0 };
    const parts = civilDateParts(this.asOfDate);
    if (!parts) return { count: 0, rowIndex: null, truncated: false, buckets: {}, rowsOnPage: 0 };
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
      buckets,
      rowsOnPage: parsed.candidates.length,
    };
  }

  /**
   * The review list's own period + paging controls, read once. Numbers only (see
   * {@link inPageReviewListRange}); a read that throws reports {@link UNREAD_RANGE_CENSUS}, so an unknown
   * never reads as "there is no period filter".
   */
  private async rangeCensus(): Promise<ReviewListRangeCensus> {
    const parts = civilDateParts(this.asOfDate);
    if (!parts) return UNREAD_RANGE_CENSUS;
    try {
      return parseRangeCensus(await this.page.evaluate<unknown>(inPageReviewListRange(parts)));
    } catch {
      return UNREAD_RANGE_CENSUS;
    }
  }

  /** Rewind the review list to its first screen. Read-only in the same sense the sweep is. */
  private async rewindList(): Promise<void> {
    await this.page.evaluate(IN_PAGE_SCROLL_REVIEW_LIST_TOP).catch(() => undefined);
    await new Promise<void>((resolve) => setTimeout(resolve, LOCATE_SCROLL_SETTLE_MS));
  }

  /** One screen down the review list. Read-only: it moves the viewport, it presses nothing. */
  private async scrollListOnce(): Promise<{ rowCount: number; moved: boolean; atBottom: boolean; rowsInPane: number }> {
    try {
      const r = await this.page.evaluate<{ rowCount: number; moved: boolean; atBottom: boolean; rowsInPane?: number }>(
        IN_PAGE_SCROLL_REVIEW_LIST,
      );
      return {
        rowCount: Number(r?.rowCount ?? 0), moved: !!r?.moved, atBottom: !!r?.atBottom,
        rowsInPane: Number(r?.rowsInPane ?? 0),
      };
    } catch {
      return { rowCount: 0, moved: false, atBottom: true, rowsInPane: 0 };
    }
  }

  /**
   * One pass down the review list, from wherever the viewport is: scan, scroll a screen, scan again.
   *
   * The list renders lazily AND recycles — rows above the viewport are removed from the DOM as rows below it
   * are added — so no single scan can see the whole list and the sweep has to keep a UNION of what every scan
   * saw. That union (`bucketsSeen`) is what later separates "the target is not in this list" from "this list
   * does not reach the target's date".
   */
  private async sweep(): Promise<{ scan: LadderScan; atBottom: boolean; screens: number; bucketsSeen: Record<string, number> }> {
    let d = await this.ladder();
    const bucketsSeen: Record<string, number> = { ...d.buckets };
    let atBottom = false;
    let screens = 0;
    // Stops the moment the row is found (so nothing scrolls out from under the match that highlight/open/fill
    // are about to use), at the bottom, or at the step cap.
    for (let step = 0; d.count === 0 && step < LOCATE_SCROLL_STEPS; step++) {
      const s = await this.scrollListOnce();
      if (!s.moved) break;
      screens = step + 1;
      await new Promise<void>((resolve) => setTimeout(resolve, LOCATE_SCROLL_SETTLE_MS));
      d = await this.ladder();
      for (const [bucket, n] of Object.entries(d.buckets)) {
        bucketsSeen[bucket] = Math.max(bucketsSeen[bucket] ?? 0, n);
      }
      this.diag("aw_naver_reply_locate_sweep", {
        step: step + 1, rowsOnPage: s.rowCount, rowsInPane: s.rowsInPane, matches: d.count, atBottom: s.atBottom,
      });
      if (d.count > 0) break;
      if (s.atBottom) {
        atBottom = true;
        break;
      }
    }
    return { scan: d, atBottom, screens, bucketsSeen };
  }

  /**
   * What a sweep that found nothing actually established.
   *
   * The target's own recency bucket is the only thing the run can compare against what it saw, and it is
   * enough for the distinction that matters: a list the sweep read to the BOTTOM without ever showing a row
   * from that bucket is not a list the target could have been in. Anything less — the sweep hit its step cap,
   * or it did see that bucket — stays the old, weaker claim.
   */
  private missVerdict(atBottom: boolean, bucketsSeen: Record<string, number>): LocateMissVerdict {
    const rowsSeen = Object.values(bucketsSeen).reduce((a, b) => a + b, 0);
    if (!atBottom || rowsSeen === 0) return "NOT_ESTABLISHED";
    return (bucketsSeen[this.hint.recencyBucket] ?? 0) === 0 ? "OUT_OF_LISTED_RANGE" : "NOT_ON_SURFACE";
  }

  /**
   * Find the one row the approved reply targets.
   *
   * <b>Observed live 2026-09-05, and the reason this method is no longer just a sweep.</b> A run swept fifteen
   * screens of the seller center review grid, reached the bottom of the pane, and matched nothing — while
   * every row it saw was `TODAY` or `THIS_WEEK` and the target was eight days old. Two days earlier the SAME
   * screen had matched a review of the same date on the ninth screen. Nothing about the grid had changed: the
   * review had aged past the period the screen shows by default, and scrolling cannot reach outside a filter.
   * Reporting that as `TARGET_NOT_FOUND` tells the seller their review is not there, which is false, and the
   * repair it implies (look again) cannot work.
   *
   * So a sweep that ends at the bottom of the list without ever showing the target's own recency bucket now
   * says so — and then WAITS, read-only, the way {@link waitForSurfaceReady} waits for a login: the seller
   * widens the period on the page in front of them, presses the screen's own 조회, and the run re-sweeps the
   * new list and continues. Nothing here changes the filter, types a date, or presses anything.
   */
  async locateReviewRow(): Promise<LocateRowResult> {
    let out = await this.sweep();
    if (out.scan.count === 0) {
      const verdict = this.missVerdict(out.atBottom, out.bucketsSeen);
      const census = await this.rangeCensus();
      this.diag("aw_naver_reply_locate_miss", {
        verdict,
        targetBucket: this.hint.recencyBucket,
        targetBucketRowsSeen: out.bucketsSeen[this.hint.recencyBucket] ?? 0,
        screensSwept: out.screens,
        atBottom: out.atBottom,
        dateInputCount: census.dateInputCount,
        listStartDaysBefore: census.startDaysBefore,
        listEndDaysBefore: census.endDaysBefore,
        pagerNumberCount: census.pagerNumberCount,
        highestPagerNumber: census.highestPagerNumber,
      });
      // The wait is offered only where it can actually be resolved: the screen has to HAVE a period control
      // for "widen the period" to be a thing the seller can do. Without one, waiting would be waiting for
      // something nobody was asked for.
      if (verdict === "OUT_OF_LISTED_RANGE" && census.dateInputCount > 0 && this.rangeWaitMs > 0) {
        out = await this.waitForListToReachTarget(census);
      }
    }
    const d = out.scan;
    this.matchCount = d.count;
    this.matchedRowIndex = d.rowIndex;
    // A truncated scan that found nothing is "not established", which the engine reads as not found; a
    // truncated scan that found exactly one is still exactly one on what was seen — accepted, like the probe.
    if (d.count === 1 && d.rowIndex !== null) return { count: 1, sig: composerSigFor(["ladder-row", d.rowIndex]) };
    return { count: d.count };
  }

  /**
   * Watch — read-only — for the list to start showing the period the target is in, then sweep it again.
   *
   * Two triggers, and both are the seller's own act: the period controls now read a different window (the
   * normal case, detected by re-reading the same census), or enough time passed that a re-sweep is due anyway
   * (the surface that re-queries without its inputs changing). Every re-sweep starts by rewinding the list,
   * because a re-queried grid renders from row one and a scan that began at the old scroll position would
   * read its tail and call the rows above it absent.
   */
  private async waitForListToReachTarget(
    initial: ReviewListRangeCensus,
  ): Promise<{ scan: LadderScan; atBottom: boolean; screens: number; bucketsSeen: Record<string, number> }> {
    const deadline = Date.now() + this.rangeWaitMs;
    let lastSweptAt = Date.now();
    let last = initial;
    this.diag("aw_naver_reply_range_wait", { waitMs: this.rangeWaitMs, targetBucket: this.hint.recencyBucket });
    for (;;) {
      if (Date.now() >= deadline) {
        this.diag("aw_naver_reply_range_wait_timeout", { targetBucket: this.hint.recencyBucket });
        return { scan: { count: 0, rowIndex: null, truncated: false, buckets: {}, rowsOnPage: 0 }, atBottom: true, screens: 0, bucketsSeen: {} };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, RANGE_POLL_INTERVAL_MS));
      // Cheap check first: after a re-query the target may simply be on the first screen.
      const quick = await this.ladder();
      if (quick.count === 1 && quick.rowIndex !== null) {
        this.diag("aw_naver_reply_range_resolved", { via: "FIRST_SCREEN" });
        return { scan: quick, atBottom: false, screens: 0, bucketsSeen: quick.buckets };
      }
      const census = await this.rangeCensus();
      const windowChanged =
        census.startDaysBefore !== last.startDaysBefore || census.endDaysBefore !== last.endDaysBefore;
      const due = Date.now() - lastSweptAt >= RANGE_RESWEEP_INTERVAL_MS;
      if (!windowChanged && !due) continue;
      last = census;
      lastSweptAt = Date.now();
      this.diag("aw_naver_reply_range_resweep", {
        reason: windowChanged ? "WINDOW_CHANGED" : "PERIODIC",
        listStartDaysBefore: census.startDaysBefore,
        listEndDaysBefore: census.endDaysBefore,
      });
      await this.rewindList();
      const out = await this.sweep();
      if (out.scan.count > 0) {
        this.diag("aw_naver_reply_range_resolved", { via: "RESWEEP", screens: out.screens });
        return out;
      }
    }
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
  /**
   * Make this review's composer exist, then prove the panel it is in belongs to this review.
   *
   * <b>Two shapes, and the second is NAVER's</b> (observed live 2026-09-03). Where a row carries its own
   * 답글 control, that control is pressed and the composer appears inside the row, as before. The NAVER review
   * grid has no such control and no composer in the row at all: the review-body cell is a link that opens a
   * MODAL, and the reply box lives there. So the fallback presses the one control whose own id fingerprints to
   * this review, and then re-establishes identity on the other side of the click — the panel's text must
   * fingerprint to the same `review-body-fingerprint/v1` the submission target carries. Only then does it
   * become the scope everything downstream fills into.
   *
   * The click stays where it always was ({@code reply-composer-open.ts}, the one file allowed one press), and
   * submit wording still disqualifies a control before its identity is even considered.
   */
  async openComposer(): Promise<ComposerOpenResult> {
    if (this.matchedRowIndex === null) return { opened: false, reason: "NOT_FOUND" };
    const tagged = await this.page.evaluate<number>(IN_PAGE_TAG_OPEN_CONTROL);
    if (tagged === 0 && this.reviewIdFingerprint) {
      // No worded control in this row. Try the exact-identity route: the control that names THIS review.
      const detailControls = await this.page.evaluate<number>(inPageTagDetailControl(this.reviewIdFingerprint));
      this.diag("aw_naver_reply_detail_control", { candidates: detailControls });
      if (detailControls === 1) {
        const opened = await openComposer(this.page);
        if (!opened.opened) {
          this.diag("aw_naver_reply_open_composer", { via: "detail", opened: false, reason: opened.reason ?? null });
          return opened;
        }
        // The click landed somewhere; nothing may be typed until the panel says which review it is showing.
        await new Promise<void>((resolve) => setTimeout(resolve, DETAIL_SETTLE_MS));
        const scope = await this.page.evaluate<{ candidates: number; matched: number; nested?: number }>(
          inPageVerifyDetailScope(this.hint.bodyFingerprint),
        );
        this.diag("aw_naver_reply_detail_scope", {
          candidates: scope.candidates, matched: scope.matched, nested: scope.nested ?? 0,
        });
        if (scope.matched !== 1) {
          return { opened: false, reason: scope.candidates > 1 ? "AMBIGUOUS" : "NOT_FOUND" };
        }
        this.diag("aw_naver_reply_open_composer", { via: "detail", opened: true });
        return { opened: true };
      }
      if (detailControls > 1) return { opened: false, reason: "AMBIGUOUS" };
    }
    if (tagged === 0) {
      // Nothing to press: either the composer is already showing in this row's scope or no open word exists.
      const signals = await this.page.evaluate<{ composerCandidateCount: number }>(IN_PAGE_SCOPED_COMPOSER_SIGNALS);
      const already = signals.composerCandidateCount === 1;
      this.diag("aw_naver_reply_open_composer", { taggedControls: 0, composersInRow: signals.composerCandidateCount, opened: already });
      return already ? { opened: true } : { opened: false, reason: "NOT_FOUND" };
    }
    if (tagged !== 1) {
      this.diag("aw_naver_reply_open_composer", { taggedControls: tagged, opened: false });
      return { opened: false, reason: tagged > 1 ? "AMBIGUOUS" : "NOT_FOUND" };
    }
    const res = await openComposer(this.page);
    this.diag("aw_naver_reply_open_composer", { taggedControls: 1, opened: res.opened, reason: res.opened ? null : (res.reason ?? null) });
    return res;
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
    this.diag("aw_naver_reply_locate_composer", { composersInRow: signals.composerCandidateCount });
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
    if (!decision.fill) {
      this.diag("aw_naver_reply_fill_refused", {
        reason: decision.reason, rowMatchCount: this.matchCount, composerCount: this.composerCount,
        reviewIdVerdict: this.reviewIdVerdict().kind, hasDraft: this.draftBody != null && this.draftBody.length > 0,
      });
      return { filled: false, reason: decision.reason };
    }
    const res = await fillComposer(this.page, this.draftBody!);
    this.diag("aw_naver_reply_fill", { filled: res.filled, reason: res.filled ? null : (res.reason ?? null) });
    return res;
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
