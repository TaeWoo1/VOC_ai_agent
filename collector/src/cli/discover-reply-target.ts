/**
 * Live NAVER review-row **discovery** — read-only, NO-CLICK, one human-attended run (NO scheduler loop).
 *
 *   node --env-file=.env src/cli/discover-reply-target.ts --login    --i-understand-this-opens-live-naver
 *   node --env-file=.env src/cli/discover-reply-target.ts --discover --classify-only \
 *        --expected-hint .reply-target/hint.json  --i-understand-this-opens-live-naver
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
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext, type PwPage } from "../profile";
import {
  composerSigFor,
  reviewRowLocateDecision,
  type RecencyBucket,
  type ReplyTargetHint,
  type ReviewRowSignal,
} from "../action-window/reply-submission/reply-surface";
import { approvalRequiredMessage, hasLiveRunApproval, isClassifyOnly } from "./live-run-approval";

const EXPECTED_HINT_FLAG = "--expected-hint";
const RECENCY_BUCKETS: readonly RecencyBucket[] = ["TODAY", "THIS_WEEK", "OLDER"];

/** PLACEHOLDER landing; the human navigates to the review-management list themselves. */
const NAVER_LANDING_URL = "https://sell.smartstore.naver.com/";

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
 * deferred (no KST assumption), and the fingerprint is blocked on the backend normalization spec. The
 * structural presence booleans are what a live census can safely fill today.
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
  | "RATING_VALUE_PARSE_DEFERRED"
  | "RECENCY_BUCKET_DERIVATION_DEFERRED"
  | "FINGERPRINT_NORMALIZATION_SPEC_MISSING";

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
): DiscoverySummary {
  const count = (pred: (r: DiscoveredRowSignal) => boolean): number => rows.filter(pred).length;
  const ratingValuePresentCount = count((r) => r.rating !== null);
  const recencyBucketPresentCount = count((r) => r.recencyBucket !== null);
  const fingerprintComputableCount = count((r) => r.bodyFingerprint !== null);

  const blockers: DiscoveryBlocker[] = [];
  if (rows.length === 0) blockers.push("NO_ROW_CANDIDATES");
  if (rows.length > 0 && ratingValuePresentCount < rows.length) blockers.push("RATING_VALUE_PARSE_DEFERRED");
  if (rows.length > 0 && recencyBucketPresentCount < rows.length) blockers.push("RECENCY_BUCKET_DERIVATION_DEFERRED");
  if (fingerprintComputableCount < rows.length || rows.length === 0) {
    blockers.push("FINGERPRINT_NORMALIZATION_SPEC_MISSING");
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

async function doDiscover(expectedHintPath: string | null): Promise<void> {
  const expected = expectedHintPath ? loadExpectedHint(expectedHintPath) : null;
  const cfg = loadConfig();
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as unknown as PwPage;
  await page.goto(process.env.NAVER_REVIEW_URL ?? NAVER_LANDING_URL, { waitUntil: "domcontentloaded" });
  console.error("Navigate to the review-management list, then return here. Reading structure only…");
  // `evaluate` is deliberately absent from the pure `PwPage` structural surface; a real Playwright page
  // always has it. The census is sanitized IN-PAGE (counts/booleans/lengths) before it crosses back.
  const evalPage = page as unknown as { evaluate<R>(script: string): Promise<R> };
  const census = await evalPage.evaluate<RowCensus>(EXTRACT_ROW_CENSUS);
  const summary = classifyReviewRowStructure(censusToRows(census), expected, census.selectorKind);
  // stdout carries ONLY the sanitized summary; nothing raw is ever logged.
  console.log(JSON.stringify(summary, null, 2));
  await (ctx as unknown as { close(): Promise<void> }).close();
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
    await doDiscover(expectedHintPathFrom(args));
    return;
  }
  console.error("Usage: --login | --discover --classify-only [--expected-hint <path>]  (+ approval flag)");
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
