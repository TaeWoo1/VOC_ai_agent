/**
 * Live NAVER review-row **discovery** — read-only, NO-CLICK, one human-attended run (NO scheduler loop).
 *
 *   node --env-file=.env instruments/calibration/discover-reply-target.ts --login    --i-understand-this-opens-live-naver
 *   node --env-file=.env instruments/calibration/discover-reply-target.ts --discover --classify-only \
 *        --expected-hint .reply-target/hint.json  --i-understand-this-opens-live-naver
 *   node --env-file=.env instruments/calibration/discover-reply-target.ts --discover --classify-only \
 *        --require-sentinel  --i-understand-this-opens-live-naver
 *
 * `--require-sentinel` (alias `--sentinel`) adds the SAME-SESSION hand-off the other live CLIs use: the
 * window stays open, the human logs in / reconnects / selects the store / reaches the review list IN IT,
 * touches the sentinel file, and only then is the page read AS THEY LEFT IT (no re-navigation). It exists
 * because a cold or reconnect-required profile otherwise yields an empty census and wastes the run's
 * single-use approval. The gate is read-only: on timeout the page is never read and no summary is emitted.
 *
 * Purpose: gather the SANITIZED structural evidence needed to implement the guided review-row seam that
 * is deliberately fail-closed in `naver-reply-driver.ts` (`locateReviewRow` / `highlightRow` /
 * `waitForRowOpen`). It classifies the rendered review-management list into counts + structural
 * booleans + opaque position signatures — it NEVER clicks a row, NEVER touches a composer, NEVER
 * submits, and NEVER mutates NAVER. This is NOT the mutating reply CLI and carries no `--submission-ref`
 * and no G6.
 *
 * PRIVACY: the in-page census returns COUNTS, BOOLEANS, and text LENGTHS only — never raw review body,
 * author, product, date string, URL, review id, or any class name. The opaque row signatures are over
 * structural POSITION only (`["row", index]`), reusing the runtime's own `reviewRowLocateDecision` /
 * `composerSigFor` so discovery and the live driver can never disagree.
 *
 * LIVE RUN — requires explicit, per-run operator approval (the `--i-understand-this-opens-live-naver`
 * READ scope; a mutating reply G6 is NOT involved because nothing is clicked or posted). The CLI refuses
 * every live action without the approval flag, and the `--discover` branch additionally requires
 * `--classify-only` (strictly no-click). A human performs login + any 2FA/CAPTCHA; the collector never
 * types credentials and never writes to NAVER. Do NOT run during planning/implementation — building and
 * verifying this file is offline and hermetic (`main()` launches nothing on import).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext, type PwPage } from "../../src/profile";
import {
  composerSigFor,
  reviewRowLocateDecision,
  type RecencyBucket,
  type ReplyTargetHint,
  type ReviewRowSignal,
} from "../../src/action-window/reply-submission/reply-surface";
import { approvalRequiredMessage, hasLiveRunApproval, isClassifyOnly } from "../../src/cli/live-run-approval";
import type { OperatorConfirmAsk } from "../../src/cli/operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";

const EXPECTED_HINT_FLAG = "--expected-hint";
const RECENCY_BUCKETS: readonly RecencyBucket[] = ["TODAY", "THIS_WEEK", "OLDER"];

/** PLACEHOLDER landing; the human navigates to the review-management list themselves. */
const NAVER_LANDING_URL = "https://sell.smartstore.naver.com/";

/**
 * Bounded read-only settle before the structural census. NAVER's review list is an SPA whose rows can
 * hydrate AFTER `domcontentloaded`, so censusing immediately risks a timing false-empty. These bound how
 * long discovery waits for candidate rows to appear before failing closed.
 */
const SETTLE_INTERVAL_MS = 500;
const SETTLE_TIMEOUT_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* ───────────────────────── Sanitized structural evidence (pure) ───────────────────────── */

/**
 * The RAW in-page census a driver extracts read-only — already sanitized in-page to counts + structural
 * booleans + text LENGTH. `selectorKind` is which GENERIC container group (index) matched most rows; it
 * is a structural fact, never a NAVER-specific selector or class name. No value, text, date, or id.
 */
export interface RowCensus {
  /** Index of the generic container group that matched the most rows, or null if none did. */
  selectorKind: number | null;
  /** How many candidate rows the winning generic group produced. */
  candidateCount: number;
  perRow: readonly RowCensusEntry[];
}

export interface RowCensusEntry {
  /** A rating-ish node is structurally present (never its value). */
  hasRatingNode: boolean;
  /** A date-ish node (`time`/`[datetime]`) is structurally present (never its value). */
  hasDateNode: boolean;
  /** A text-bearing body block is present (decided from text LENGTH only, never the text). */
  hasBodyNode: boolean;
}

/**
 * A per-row signal after (future) enrichment. During discovery `rating`/`recencyBucket`/`bodyFingerprint`
 * are null — the star VALUE is not parsed (no invented markup mapping), the date→bucket derivation is
 * deferred (no KST assumption), and the fingerprint SPEC now exists (`review-body-fingerprint/v1`, shared
 * Java↔TS) but computing it live needs in-page text extraction, deliberately deferred here (no live
 * selector). The structural presence booleans are what a live census can safely fill today.
 */
export interface DiscoveredRowSignal {
  rating: number | null;
  recencyBucket: RecencyBucket | null;
  bodyFingerprint: string | null;
  hasRatingNode: boolean;
  hasDateNode: boolean;
  hasBodyNode: boolean;
}

/** Machine-stable blocker codes surfaced in the summary — no free text, safe to log. */
export type DiscoveryBlocker =
  | "NO_ROW_CANDIDATES"
  | "ROW_CENSUS_SETTLE_TIMEOUT"
  | "RATING_VALUE_PARSE_DEFERRED"
  | "RECENCY_BUCKET_DERIVATION_DEFERRED"
  | "FINGERPRINT_LIVE_EXTRACTION_DEFERRED";

export interface DiscoveryMatch {
  /** How many fully-enriched rows match the expected hint (via the runtime's own decision). */
  matchCount: number;
  uniqueMatch: boolean;
  /** Opaque position signature of the uniquely-matched row, or null. */
  matchedRowSig: string | null;
}

/** The safe JSON the CLI emits — counts, booleans, enums, and opaque structural integers/strings only. */
export interface DiscoverySummary {
  reviewRowCandidateCount: number;
  selectorKind: number | null;
  ratingNodePresentCount: number;
  dateNodePresentCount: number;
  bodyNodePresentCount: number;
  ratingValuePresentCount: number;
  recencyBucketPresentCount: number;
  fingerprintComputableCount: number;
  /** Opaque, position-only signatures (`["row", i]`) — one per candidate row. */
  structuralRowSigs: readonly string[];
  expectedHintProvided: boolean;
  match: DiscoveryMatch | null;
  blockers: readonly DiscoveryBlocker[];
}

/** Map the sanitized in-page census to per-row signals. Fail-closed: no matched group → no rows. */
export function censusToRows(census: RowCensus): DiscoveredRowSignal[] {
  if (census.selectorKind === null) return [];
  return census.perRow.map((r) => ({
    rating: null,
    recencyBucket: null,
    bodyFingerprint: null,
    hasRatingNode: r.hasRatingNode,
    hasDateNode: r.hasDateNode,
    hasBodyNode: r.hasBodyNode,
  }));
}

/**
 * Pure classifier: turn sanitized per-row signals (+ an optional expected hint) into the safe summary.
 * The expected-hint match reuses the runtime's `reviewRowLocateDecision`, so discovery and the live
 * driver apply the identical match rule; it only runs over rows that are fully enriched (rating, bucket,
 * AND fingerprint all present), which today is none — the match therefore reports 0 and the blocker
 * codes explain why. NEVER emits any hint field value, only counts/booleans and opaque signatures.
 */
export function classifyReviewRowStructure(
  rows: readonly DiscoveredRowSignal[],
  expected: ReplyTargetHint | null,
  selectorKind: number | null,
  settleTimedOut = false,
): DiscoverySummary {
  const count = (pred: (r: DiscoveredRowSignal) => boolean): number => rows.filter(pred).length;
  const ratingValuePresentCount = count((r) => r.rating !== null);
  const recencyBucketPresentCount = count((r) => r.recencyBucket !== null);
  const fingerprintComputableCount = count((r) => r.bodyFingerprint !== null);

  const blockers: DiscoveryBlocker[] = [];
  if (settleTimedOut) blockers.push("ROW_CENSUS_SETTLE_TIMEOUT");
  if (rows.length === 0) blockers.push("NO_ROW_CANDIDATES");
  if (rows.length > 0 && ratingValuePresentCount < rows.length) blockers.push("RATING_VALUE_PARSE_DEFERRED");
  if (rows.length > 0 && recencyBucketPresentCount < rows.length) blockers.push("RECENCY_BUCKET_DERIVATION_DEFERRED");
  if (fingerprintComputableCount < rows.length || rows.length === 0) {
    blockers.push("FINGERPRINT_LIVE_EXTRACTION_DEFERRED");
  }

  let match: DiscoveryMatch | null = null;
  if (expected) {
    const enriched: ReviewRowSignal[] = rows
      .filter((r): r is DiscoveredRowSignal & { rating: number; recencyBucket: RecencyBucket; bodyFingerprint: string } =>
        r.rating !== null && r.recencyBucket !== null && r.bodyFingerprint !== null,
      )
      .map((r) => ({ rating: r.rating, recencyBucket: r.recencyBucket, bodyFingerprint: r.bodyFingerprint }));
    const decision = reviewRowLocateDecision(expected, enriched);
    match = {
      matchCount: decision.count,
      uniqueMatch: decision.count === 1,
      matchedRowSig: decision.sig ?? null,
    };
  }

  return {
    reviewRowCandidateCount: rows.length,
    selectorKind,
    ratingNodePresentCount: count((r) => r.hasRatingNode),
    dateNodePresentCount: count((r) => r.hasDateNode),
    bodyNodePresentCount: count((r) => r.hasBodyNode),
    ratingValuePresentCount,
    recencyBucketPresentCount,
    fingerprintComputableCount,
    structuralRowSigs: rows.map((_, i) => composerSigFor(["row", i])),
    expectedHintProvided: expected !== null,
    match,
    blockers,
  };
}

/* ─────────────────────── Row-census settle (pure, injected clock) ─────────────────────── */

export type SettleOutcome = "settled" | "timeout";

export interface RowCensusSettleResult {
  /** The last sanitized census read — counts/booleans/lengths only, never DOM/text. */
  census: RowCensus;
  outcome: SettleOutcome;
  /** How many times the census was read (≥ 1). */
  attempts: number;
}

/** Injected so the poll is unit-testable offline with a fake census + fake sleep — no browser, no timers. */
export interface RowCensusSettleDeps {
  /** Read ONE sanitized census (in the CLI this is the in-page `EXTRACT_ROW_CENSUS`). */
  readCensus: () => Promise<RowCensus>;
  sleep: (ms: number) => Promise<void>;
}

export interface RowCensusSettleOptions {
  intervalMs: number;
  timeoutMs: number;
}

/**
 * Poll the SANITIZED row census until candidate rows appear or a bounded budget expires, so a live SPA
 * whose rows hydrate after `domcontentloaded` is not mis-read as empty. Reads only the {@link RowCensus}
 * (counts/booleans/lengths) — never DOM, text, value, date, id, or URL. Elapsed time is summed from the
 * interval we control (no wall-clock read), keeping it deterministic under test. Fail-closed: if no
 * candidate ever appears within the budget, the last (empty) census is returned with `timeout`.
 */
export async function settleRowCensus(
  deps: RowCensusSettleDeps,
  opts: RowCensusSettleOptions,
): Promise<RowCensusSettleResult> {
  const interval = Math.max(1, opts.intervalMs);
  const budget = Math.max(0, opts.timeoutMs);
  let elapsed = 0;
  let attempts = 0;
  let census = await deps.readCensus();
  attempts += 1;
  while (census.candidateCount <= 0 && elapsed < budget) {
    await deps.sleep(interval);
    elapsed += interval;
    census = await deps.readCensus();
    attempts += 1;
  }
  return { census, outcome: census.candidateCount > 0 ? "settled" : "timeout", attempts };
}

/* ─────────────── Optional expected-hint intake (owner-only file, never argv) ─────────────── */

export type ExpectedHintErrorCode = "PERMS" | "MALFORMED" | "SCHEMA";

export class ExpectedHintError extends Error {
  constructor(readonly code: ExpectedHintErrorCode) {
    super(code);
    this.name = "ExpectedHintError";
  }
}

/** Injectable fs surface so the loader is unit-testable offline without touching disk. */
export interface ExpectedHintFileDeps {
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { mode: number };
  readFileSync: (p: string, enc: "utf8") => string;
}

const DEFAULT_EXPECTED_HINT_DEPS: ExpectedHintFileDeps = { existsSync, statSync, readFileSync };

/**
 * Read the OPTIONAL expected hint from a permission-restricted, gitignored local FILE — never argv/env.
 * Unlike the mutating run's hint, discovery is not a bound run, so there is NO `submissionRef` binding;
 * only the three privacy-safe match fields are validated + returned. Fails closed (throws
 * {@link ExpectedHintError}) on group/world-readable perms, malformed JSON, or schema violations.
 * Returns null when the file is absent (discovery still classifies structure, just without a match).
 */
export function loadExpectedHint(
  path: string,
  deps: ExpectedHintFileDeps = DEFAULT_EXPECTED_HINT_DEPS,
): ReplyTargetHint | null {
  if (!deps.existsSync(path)) return null;
  if ((deps.statSync(path).mode & 0o077) !== 0) throw new ExpectedHintError("PERMS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFileSync(path, "utf8"));
  } catch {
    throw new ExpectedHintError("MALFORMED");
  }
  if (typeof parsed !== "object" || parsed === null) throw new ExpectedHintError("MALFORMED");
  const r = parsed as Record<string, unknown>;
  const rating = r.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ExpectedHintError("SCHEMA");
  }
  if (typeof r.recencyBucket !== "string" || !RECENCY_BUCKETS.includes(r.recencyBucket as RecencyBucket)) {
    throw new ExpectedHintError("SCHEMA");
  }
  if (typeof r.bodyFingerprint !== "string" || r.bodyFingerprint.length === 0 || r.bodyFingerprint.length > 128) {
    throw new ExpectedHintError("SCHEMA");
  }
  return { rating, recencyBucket: r.recencyBucket as RecencyBucket, bodyFingerprint: r.bodyFingerprint };
}

/** Extract the `--expected-hint <path>` value, or null if the flag is absent. */
export function expectedHintPathFrom(args: readonly string[]): string | null {
  const i = args.indexOf(EXPECTED_HINT_FLAG);
  const raw = i >= 0 ? args[i + 1] : undefined;
  return raw && !raw.startsWith("--") ? raw : null;
}

/* ──────────────── Same-session confirmation gate (read-only hand-off, pure core) ──────────────── */

/** Budget for the human hand-off, mirroring the other same-session CLIs. */
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/** What one hand-off produced. Only `ready` lets the census run. */
export type ConfirmedGateOutcome = "ready" | "abort" | "timeout";

/**
 * Opt into same-session sentinel mode. Mirrors `capture-export-same-session`'s flag vocabulary so the
 * operator uses one muscle memory across the live CLIs; `--no-sentinel` is an explicit override.
 */
export function sentinelModeFrom(args: readonly string[]): boolean {
  return (args.includes("--require-sentinel") || args.includes("--sentinel")) && !args.includes("--no-sentinel");
}

/**
 * Sequence the hand-off: the census runs **only** after the gate reports `ready`. On anything else the
 * census is never invoked, so a half-prepared page is never read. Kept as its own tiny pure combinator
 * precisely so this ordering invariant is unit-testable without a browser.
 */
export async function runConfirmedCensus<T>(
  gate: () => Promise<ConfirmedGateOutcome>,
  census: () => Promise<T>,
): Promise<{ outcome: "ready"; result: T } | { outcome: "timeout" }> {
  const outcome = await gate();
  if (outcome !== "ready") return { outcome: "timeout" };
  return { outcome: "ready", result: await census() };
}

/**
 * What the operator is asked to do, and confirm.
 *
 * It used to end with 'just say "ready" and Claude creates it' — the channel that failed on 2026-08-13, when
 * the assistant created the file on the strength of a chat line the operator never wrote.
 */
const CONFIRM_ASK: OperatorConfirmAsk = {
  title: "NAVER 리뷰 목록 구조 판독",
  headline: "리뷰 목록이 그려진 화면에 직접 도착한 뒤 확인해 주세요.",
  lines: [
    "HAND-OFF — this window is yours. In THIS SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Complete any Commerce reconnect / account-store selection.",
    "  3) Navigate to the review-management list, with review rows visibly rendered.",
    "  4) Leave the browser OPEN.",
    "",
    "Then press [현재 화면 확인] in the SellerOps confirmation tab — nothing else advances this run. Only",
    "then is the page read — READ-ONLY, structure only: no click, no typing, no submit, no",
    "download, no upload, no status write.",
  ],
};

/* ─────────────────────────── In-page census (read-only, generic) ─────────────────────────── */

/**
 * GENERIC structural census — NO NAVER-specific selector or class name. Reports COUNTS + structural
 * booleans + text LENGTH only; never raw text/value/date/id. It identifies which generic container group
 * holds the most repeated rows so a human can (offline) confirm the real row selector — it does NOT claim
 * to locate the approved review. `[class*="star"|"rating"]` is a cross-framework structural hint, and only
 * its PRESENCE (a boolean) is ever returned, never the class string.
 */
const EXTRACT_ROW_CENSUS = `(() => {
  var GROUPS = ['[role="row"]', 'article', 'ul > li', 'ol > li'];
  var best = { selectorKind: null, count: 0 };
  for (var i = 0; i < GROUPS.length; i++) {
    var n = document.querySelectorAll(GROUPS[i]).length;
    if (n > best.count) { best = { selectorKind: i, count: n }; }
  }
  var rows = best.selectorKind === null ? [] :
    Array.prototype.slice.call(document.querySelectorAll(GROUPS[best.selectorKind]));
  var perRow = rows.map(function (el) {
    var hasRatingNode = !!el.querySelector('[role="img"][aria-label], [class*="star"], [class*="rating"]');
    var hasDateNode = !!el.querySelector('time, [datetime]');
    var textLen = (el.textContent || '').trim().length;
    return { hasRatingNode: hasRatingNode, hasDateNode: hasDateNode, hasBodyNode: textLen > 8 };
  });
  return { selectorKind: best.selectorKind, candidateCount: best.count, perRow: perRow };
})()`;

/* ────────────────────────────── CLI (live, read-only) ────────────────────────────── */

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER review-row DISCOVERY — read-only, no-click. Requires per-run operator");
  console.error(" approval (READ scope). A human logs in; the collector never types NAVER credentials,");
  console.error(" never clicks a row, never touches a composer, never writes to NAVER. Ctrl-C to abort.");
  console.error(line);
}

async function doLogin(): Promise<void> {
  const cfg = loadConfig();
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as unknown as PwPage;
  await page.goto(NAVER_LANDING_URL, { waitUntil: "domcontentloaded" });
  log("discover.reply.login.prompt", { note: "human-login-required" });
  console.error("Log in (and clear any 2FA/CAPTCHA) in the opened window, then close it.");
}

async function doDiscover(expectedHintPath: string | null, sentinelMode: boolean): Promise<void> {
  const expected = expectedHintPath ? loadExpectedHint(expectedHintPath) : null;
  const cfg = loadConfig();
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The confirmation surface is a SellerOps-owned tab in the SAME window; `entryPage` is the operator's own
  // page, captured before that tab existed. Opened in both modes so the two differ only in whether the run
  // WAITS on it — the auto path must not be able to read the blank surface either.
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => false,
    timeoutMs: CONFIRM_TIMEOUT_MS,
  });
  try {
    const page = confirmHost.entryPage as unknown as PwPage;
    await page.goto(process.env.NAVER_REVIEW_URL ?? NAVER_LANDING_URL, { waitUntil: "domcontentloaded" });
    // `evaluate` is deliberately absent from the pure `PwPage` structural surface; a real Playwright page
    // always has it. The census is sanitized IN-PAGE (counts/booleans/lengths) before it crosses back.
    const evalPage = page as unknown as { evaluate<R>(script: string): Promise<R> };

    /** The READ-ONLY reads, identical in both modes. Runs only once the page is ours to read. */
    const readSanitized = async (): Promise<DiscoverySummary> => {
      // Bounded read-only settle: re-read the sanitized census until rows appear or the budget expires,
      // so an SPA that hydrates rows after domcontentloaded is not mis-read as empty. No click, no value read.
      const { census, outcome } = await settleRowCensus(
        { readCensus: () => evalPage.evaluate<RowCensus>(EXTRACT_ROW_CENSUS), sleep },
        { intervalMs: SETTLE_INTERVAL_MS, timeoutMs: SETTLE_TIMEOUT_MS },
      );
      return classifyReviewRowStructure(
        censusToRows(census),
        expected,
        census.selectorKind,
        outcome === "timeout",
      );
    };

    if (sentinelMode) {
      // SAME-SESSION HAND-OFF. The human logs in / reconnects / selects the store / reaches the review
      // list IN THIS WINDOW; only then is the page read, AS THEY LEFT IT (no re-navigation). This exists
      // so a cold or reconnect-required profile costs an aborted run instead of an empty census.
      confirmHost.announce(CONFIRM_ASK);
      const gated = await runConfirmedCensus(
        () => confirmHost.confirm(CONFIRM_ASK).then((c) => c.signal),
        readSanitized,
      );
      if (gated.outcome === "timeout") {
        // Fail closed: never read a page the human has not finished preparing. No summary is emitted.
        console.error("No confirmation press — aborting without reading the page.");
        log("discover.reply.aborted", { reason: "no-operator-confirmation" });
        process.exitCode = 4;
        return;
      }
      // stdout carries ONLY the sanitized summary; nothing raw is ever logged.
      console.log(JSON.stringify(gated.result, null, 2));
      return;
    }

    console.error("Waiting for the review list to render, then reading structure only (no click)…");
    console.log(JSON.stringify(await readSanitized(), null, 2));
  } finally {
    await (ctx as unknown as { close(): Promise<void> }).close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  banner();
  if (!hasLiveRunApproval(args)) {
    console.error(approvalRequiredMessage());
    process.exitCode = 3;
    return;
  }
  if (args.includes("--login")) {
    await doLogin();
    return;
  }
  if (args.includes("--discover")) {
    // Discovery is read-only-only: the no-click classify mode is mandatory here.
    if (!isClassifyOnly(args)) {
      console.error("Refusing: --discover requires --classify-only — this CLI is read-only, no-click.");
      process.exitCode = 3;
      return;
    }
    await doDiscover(expectedHintPathFrom(args), sentinelModeFrom(args));
    return;
  }
  console.error(
    "Usage: --login | --discover --classify-only [--require-sentinel] [--expected-hint <path>]  (+ approval flag)",
  );
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
