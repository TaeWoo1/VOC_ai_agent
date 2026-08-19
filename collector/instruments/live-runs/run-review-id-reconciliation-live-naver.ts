/**
 * Live, GATED, human-attended NAVER **REVIEW ID RECONCILIATION probe** — strictly READ-ONLY.
 *
 *   set -a && . ./.env && set +a
 *   npx tsx instruments/live-runs/run-review-id-reconciliation-live-naver.ts -- --i-understand-this-inspects-live-naver-read-only
 *
 * The question this answers is narrow and specific: **is the review id we imported from the seller's export
 * the same id the live seller center exposes on the review row — and can we resolve exactly that one row by
 * it?** Nothing more. It is not a reply run, not a composer run, not an export run.
 *
 * What happens, in order:
 *   1. the backend hands over a one-way `review-id-fingerprint/v1` digest of this review's channel id (never
 *      the id itself — the raw id does not exist anywhere in this process);
 *   2. the operator logs in and filters the review list so the target row is visible;
 *   3. the runtime runs the discovery ladder IN THE PAGE (visible text → anchor href → input value →
 *      data-attribute → page state), fingerprinting every id-shaped token in the page so no raw identifier
 *      ever crosses back;
 *   4. the locator requires **exactly one** row to carry the matching identity — zero or several fail closed;
 *   5. the matched row is outlined and the operator confirms visually.
 *
 * The runtime NEVER clicks, types, pastes, opens a composer, or submits. The only page mutation in the whole
 * run is an outline (plus a marker attribute) on the matched row, removed on teardown. Refuses without its own
 * read-only approval flag, refuses any MUTATING approval flag, and refuses under `NODE_ENV=production`.
 *
 * **On navigation, precisely:** there is exactly ONE `goto`, and it opens the configured
 * `NAVER_REVIEW_URL` to start the session — before the operator has done anything. From the moment the
 * operator signals readiness onward the runtime never navigates, reloads, or follows a link; every page
 * transition after that point is the operator's own. A source guard pins the single `goto` in place.
 *
 * If the surface exposes no usable identifier, this stops and reports the ladder evidence rung by rung. It
 * does not fall back to the operator-calibrated flow, and it never reports a weaker match as an identity.
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserContext, Page, Response } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import { login, fetchReviewIdentityFingerprint } from "../../src/upload";
import { loadRequestBundle } from "../../src/action-window/reply-submission/reply-target-bundle";
import {
  hasLiveRunApproval,
  hasReplyRunApproval,
  hasReviewIdProbeApproval,
  mutatingFlagOnReadOnlyProbeMessage,
  reviewIdProbeApprovalRequiredMessage,
  APPROVAL_FLAG,
  REPLY_APPROVAL_FLAG,
} from "../../src/cli/live-run-approval";
import {
  inPageOutlineRowAt,
  inPageReviewIdLadder,
  IN_PAGE_ID_OUTLINE_TEARDOWN,
  type OutlineOutcome,
} from "../../src/action-window/reply-submission/review-id-probe-inpage";
import {
  REVIEW_ID_SOURCE_ORDER,
  ROW_MATCH_MODES,
  locateRowByReviewId,
  reviewIdLocatorKeyFromFingerprint,
  type LiveRowCandidate,
  type LocateOutcome,
  type ReviewIdSource,
} from "../../src/action-window/reply-submission/review-id-locator";
import { networkResponseExposesReviewId } from "../../src/action-window/reply-submission/review-id-network-scan";
import { currentKstDate } from "../../src/cli/kst-date";

const REVIEW_CHANNEL_CODE = "naver";
const REQUEST_BUNDLE_REL_PATH = ".reply-target/request.json";
const RUN_RECORD_REL_DIR = ".review-id-runs";
const READY_TIMEOUT_MS = 15 * 60_000;
const CONFIRM_TIMEOUT_MS = 15 * 60_000;
const RESCAN_TIMEOUT_MS = 15 * 60_000;
/** Rescans are operator-driven view adjustments, not retries of the same view — a small bound is plenty. */
const MAX_SCANS = 10;
const SENTINEL_POLL_INTERVAL_MS = 750;
/** Response bodies are read at most this many times, so a busy page can never turn rung 6 into a crawl. */
const MAX_SCANNED_RESPONSES = 200;

export const PROBE_PRODUCTION_REFUSAL =
  "Refusing to run the live review-id probe under NODE_ENV=production. This tool is for a user-owned test seller account only.";

/**
 * The gate for this CLI. A MUTATING approval flag is a refusal, not a stronger permission: it means the
 * operator believes they are running something else.
 */
export function reviewIdProbeRefusal(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { reason: string; exitCode: number } | null {
  if (hasReplyRunApproval([...args])) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(REPLY_APPROVAL_FLAG), exitCode: 6 };
  }
  if (hasLiveRunApproval([...args])) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(APPROVAL_FLAG), exitCode: 6 };
  }
  if (!hasReviewIdProbeApproval([...args])) {
    return { reason: reviewIdProbeApprovalRequiredMessage(), exitCode: 3 };
  }
  if (env.NODE_ENV === "production") {
    return { reason: PROBE_PRODUCTION_REFUSAL, exitCode: 4 };
  }
  return null;
}

/** `YYYY-MM-DD` → the civil parts the in-page recency bucket is computed against. Null if unparseable. */
export function civilDateParts(kstDate: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(kstDate);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** The raw shape the in-page ladder returns, before it is validated into typed candidates. */
interface RawLadderResult {
  rows?: unknown;
  pageStateFingerprints?: unknown;
  rowCount?: unknown;
  rowsTruncated?: unknown;
  tokensTruncated?: unknown;
  scopeExpandedRows?: unknown;
}

const HEX64 = /^[0-9a-f]{64}$/;
const SOURCES = new Set<string>(REVIEW_ID_SOURCE_ORDER);

/**
 * Validates the in-page result into typed candidates. The page is untrusted input: a hostile or merely broken
 * surface must not be able to inject an arbitrary shape into the locator, and — because `rowIndex` is what the
 * outline step later addresses — it must not be able to point the outline at a row of its choosing.
 *
 * So `rowIndex` is **not taken from the page at all**: it is the entry's own array position, and any entry
 * whose claimed index disagrees is dropped. A page can still lie about what a row contains (that is what the
 * exactly-one rule and the outline re-verification are for), but it cannot redirect the highlight.
 */
export function parseLadderResult(raw: unknown): {
  candidates: LiveRowCandidate[];
  pageStateFingerprints: string[];
  rowCount: number;
  rowsTruncated: boolean;
  tokensTruncated: boolean;
  scopeExpandedRows: number;
} {
  const result = (raw ?? {}) as RawLadderResult;
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const candidates: LiveRowCandidate[] = [];
  for (const [position, entry] of rows.entries()) {
    const row = (entry ?? {}) as {
      rowIndex?: unknown;
      idFingerprints?: unknown;
      secondary?: { rating?: unknown; recencyBucket?: unknown };
    };
    // The index must be the position it actually occupies — nothing else is addressable later.
    if (row.rowIndex !== position) continue;
    const fingerprints: { source: ReviewIdSource; fingerprint: string }[] = [];
    for (const item of Array.isArray(row.idFingerprints) ? row.idFingerprints : []) {
      const f = (item ?? {}) as { source?: unknown; fingerprint?: unknown };
      if (typeof f.source !== "string" || !SOURCES.has(f.source)) continue;
      if (typeof f.fingerprint !== "string" || !HEX64.test(f.fingerprint)) continue;
      fingerprints.push({ source: f.source as ReviewIdSource, fingerprint: f.fingerprint });
    }
    const rating = row.secondary?.rating;
    const bucket = row.secondary?.recencyBucket;
    candidates.push({
      rowIndex: position,
      idFingerprints: fingerprints,
      secondary: {
        rating: typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
        recencyBucket: typeof bucket === "string" ? bucket : null,
      },
    });
  }
  const pageState = (Array.isArray(result.pageStateFingerprints) ? result.pageStateFingerprints : []).filter(
    (f): f is string => typeof f === "string" && HEX64.test(f),
  );
  const rowCount = typeof result.rowCount === "number" && result.rowCount >= 0 ? result.rowCount : candidates.length;
  return {
    candidates,
    pageStateFingerprints: pageState,
    rowCount,
    // Anything other than an explicit `false` is treated as "possibly truncated" — an unknown must never
    // read as a clean scan, because the whole point of the flag is to stop a miss becoming a claim.
    rowsTruncated: result.rowsTruncated !== false || candidates.length !== rows.length,
    tokensTruncated: result.tokensTruncated !== false,
    scopeExpandedRows:
      typeof result.scopeExpandedRows === "number" && result.scopeExpandedRows >= 0 ? result.scopeExpandedRows : 0,
  };
}

/**
 * How many candidate rows exposed ANY id-shaped token at each rung — the ladder evidence reported when the
 * identity is not found. Counts only: it says where the surface exposes identifiers, never which.
 */
export function ladderExposure(candidates: readonly LiveRowCandidate[]): Record<ReviewIdSource, number> {
  const out = {} as Record<ReviewIdSource, number>;
  for (const source of REVIEW_ID_SOURCE_ORDER) {
    out[source] = candidates.filter((row) => row.idFingerprints.some((f) => f.source === source)).length;
  }
  return out;
}

/** Everything the run record is built from. Deliberately takes no id, key, page, URL, or config. */
export interface ProbeRecordInput {
  runId: string;
  outcome: LocateOutcome | null;
  exposure: Record<ReviewIdSource, number> | null;
  rowCount: number;
  rowsTruncated: boolean;
  tokensTruncated: boolean;
  scopeExpandedRows: number;
  scanCount: number;
  pageStatePresence: boolean;
  networkPresence: boolean;
  networkTruncated: boolean;
  outline: OutlineOutcome | null;
  operatorConfirmed: boolean | null;
}

/**
 * The run's whole reportable result — printed to stdout and persisted.
 *
 * Extracted as a pure function so the privacy guarantee is **testable rather than asserted**: its inputs
 * cannot carry an identifier, so no field it produces can. Every value is a count, an enum, a boolean, or the
 * random run id.
 */
export function buildProbeRecord(input: ProbeRecordInput) {
  const { outcome, outline } = input;
  const matched = outcome?.matched ?? false;
  return {
    runId: input.runId,
    channel: REVIEW_CHANNEL_CODE,
    matchMode: matched ? ("channel-review-id" as const) : null,
    matchModeCaveat: matched ? ROW_MATCH_MODES["channel-review-id"].caveat : null,
    matched,
    failureReason: outcome && !outcome.matched ? outcome.reason : null,
    matchCount: outcome?.matchCount ?? 0,
    matchedSource: outcome?.matched ? outcome.source : null,
    candidateRowCount: input.rowCount,
    ladderExposure: input.exposure,
    rowsTruncated: input.rowsTruncated,
    tokensTruncated: input.tokensTruncated,
    /** How many rows were scanned through an exclusive ancestor rather than the innermost container. */
    scopeExpandedRows: input.scopeExpandedRows,
    /** How many times the operator adjusted the view and the runtime re-read it. */
    scanCount: input.scanCount,
    pageStatePresence: input.pageStatePresence,
    networkResponsePresence: input.networkPresence,
    networkScanTruncated: input.networkTruncated,
    secondary: outcome?.matched ? outcome.secondary : (outcome?.secondary ?? null),
    outline,
    /** True only when the identity matched AND the same row was still there to be shown. */
    highlighted: outline === "outlined",
    operatorConfirmed: input.operatorConfirmed,
    /**
     * The account half of the key comes from the request bundle, and the browser profile's actual seller
     * session is never read back — so `CONTEXT_MISMATCH` cannot fire in this flow. Recorded explicitly rather
     * than left implied: this run proves REVIEW identity, not that the open session belongs to that account.
     */
    sellerAccountBinding: "asserted-by-request-bundle-not-verified-against-session" as const,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    if (typeof t.unref === "function") t.unref();
  });
}
function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  for (let i = 0; i < Math.max(1, Math.ceil(timeoutMs / SENTINEL_POLL_INTERVAL_MS)); i += 1) {
    if (existsSync(path)) return true;
    await sleep(SENTINEL_POLL_INTERVAL_MS);
  }
  return false;
}
async function waitForEither(a: string, b: string, timeoutMs: number): Promise<"a" | "b" | null> {
  for (let i = 0; i < Math.max(1, Math.ceil(timeoutMs / SENTINEL_POLL_INTERVAL_MS)); i += 1) {
    if (existsSync(a)) return "a";
    if (existsSync(b)) return "b";
    await sleep(SENTINEL_POLL_INTERVAL_MS);
  }
  return null;
}
function evalOn<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

/**
 * Rung 6 — a PASSIVE response observer. It never issues a request: it only looks at bodies the browser
 * already fetched because the operator navigated or filtered. Each body is scanned for the target identity
 * and immediately discarded; the observer retains one boolean and one truncation flag, nothing else.
 */
function armNetworkObserver(
  ctx: BrowserContext,
  targetFingerprint: string,
): { present: boolean; truncated: boolean; settle: () => Promise<void> } {
  const state = { present: false, truncated: false, settle: async () => undefined as void };
  const inFlight = new Set<Promise<void>>();
  let scanned = 0;
  ctx.on("response", (response: Response) => {
    if (state.present || scanned >= MAX_SCANNED_RESPONSES) return;
    const type = (response.headers()["content-type"] ?? "").toLowerCase();
    if (!type.includes("json") && !type.includes("javascript") && !type.includes("text/plain")) return;
    scanned += 1;
    const pending = response
      .text()
      .then((body) => {
        const { present, scan } = networkResponseExposesReviewId(targetFingerprint, body);
        if (present) state.present = true;
        if (scan.truncated) state.truncated = true;
      })
      .catch(() => undefined)
      .finally(() => inFlight.delete(pending));
    inFlight.add(pending);
  });
  // Body reads are async, so the flags are only meaningful once the outstanding ones have landed. Without
  // this the rung-6 result would be non-deterministically under-reported — a silent false "not exposed".
  state.settle = async () => {
    await Promise.all([...inFlight]);
  };
  return state;
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" REVIEW ID RECONCILIATION — READ-ONLY. The runtime reads the review list and outlines the ONE");
  console.error(" row whose channel review id matches this review. It never clicks, navigates, types, pastes,");
  console.error(" opens a composer, or submits. Exactly one match is required; zero or several fail closed.");
  console.error(" No raw review id exists in this process — only one-way fingerprints.");
  console.error(line);
}

function describeFailure(outcome: LocateOutcome, scanWasComplete: boolean): string {
  if (outcome.matched) return "";
  switch (outcome.reason) {
    case "ZERO_MATCH":
      return scanWasComplete
        ? "No row on this page carried the matching review id. Either the target is not in the current filter, or this surface does not expose the id on the row."
        : "No row carried the matching review id IN WHAT WAS SCANNED — but a cap truncated the scan, so this establishes nothing about whether the surface exposes the id. Narrow the filter and re-run.";
    case "MULTIPLE_MATCH":
      return `${outcome.matchCount} rows carried the matching review id — ambiguous, so no row is claimed.`;
    case "SECONDARY_MISMATCH":
      return `One row matched by id, but a secondary fact disagreed (${outcome.secondary?.mismatched.join(", ")}). Failing closed.`;
    case "CONTEXT_MISMATCH":
      return "The identity key belongs to a different channel/account than this run is executing under.";
    default:
      return "No usable identity key could be formed.";
  }
}

/**
 * Prints the ladder evidence for a failed scan — the honest-stop report, and what the operator reads to
 * decide whether adjusting the view is worth a rescan. Counts, enums and booleans only.
 */
function reportLadderEvidence(
  outcome: LocateOutcome,
  exposure: Record<ReviewIdSource, number> | null,
  ctx: {
    rowCount: number;
    rowsTruncated: boolean;
    tokensTruncated: boolean;
    pageStatePresence: boolean;
    networkPresence: boolean;
    networkTruncated: boolean;
    scanCount: number;
  },
): void {
  if (outcome.matched) return;
  const scanWasComplete = !ctx.rowsTruncated && !ctx.tokensTruncated;
  console.error("");
  console.error(
    `NO IDENTITY MATCH (scan ${ctx.scanCount}) — ${outcome.reason}. ${describeFailure(outcome, scanWasComplete)}`,
  );
  console.error(`Candidate rows scanned: ${ctx.rowCount}`);
  console.error("Rows exposing any id-shaped token, per row-attributable rung:");
  for (const source of REVIEW_ID_SOURCE_ORDER) {
    if (source === "page-state" || source === "network-response") continue;
    console.error(`  ${source.padEnd(18)} ${exposure?.[source] ?? 0}`);
  }
  console.error("Presence-only rungs (cannot attribute a row, so never used to locate):");
  console.error(`  page-state         ${ctx.pageStatePresence}`);
  console.error(`  network-response   ${ctx.networkPresence}${ctx.networkTruncated ? " (scan truncated)" : ""}`);
  if (!scanWasComplete) {
    console.error(
      `  ! scan truncated (rows=${ctx.rowsTruncated}, tokens=${ctx.tokensTruncated}) — a miss here proves nothing.`,
    );
  }
  if (exposure && ctx.rowCount > 0 && exposure["visible-text"] < ctx.rowCount) {
    // The tell for a lazily-rendered column: a list whose review-number column is present in every row would
    // expose a token in every row. Fewer means part of the row is not in the DOM yet.
    console.error(
      `  i only ${exposure["visible-text"]}/${ctx.rowCount} rows exposed a visible id-shaped token — if the`,
    );
    console.error("    review-number column is off-screen, its cells may not be rendered into the DOM yet.");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  banner();
  const refusal = reviewIdProbeRefusal(args, process.env);
  if (refusal) {
    console.error(refusal.reason);
    process.exit(refusal.exitCode);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management page URL first.");
    process.exit(2);
    return;
  }

  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const requestPath = resolve(collectorRoot, REQUEST_BUNDLE_REL_PATH);
  const request = loadRequestBundle(requestPath, { existsSync, statSync, readFileSync });
  if (!request) {
    console.error(`No request bundle at ${requestPath} — create it {accountId, actionRef} (0600) first.`);
    process.exit(2);
    return;
  }

  // 1) The identity, as a one-way digest. The raw channel id never leaves the database.
  const token = await login(cfg.baseUrl, cfg.email, cfg.password);
  const identity = await fetchReviewIdentityFingerprint(cfg.baseUrl, token, request.accountId, request.actionRef);
  if (!identity.channelReviewIdFingerprint) {
    console.error(
      [
        "STOPPING HONESTLY: this review has no channel-side id recorded (reviews.external_id is null),",
        "so there is nothing to reconcile against the live row. This is a real finding, not a failure:",
        "the import for this row did not carry the id column, or the channel does not provide one.",
      ].join("\n"),
    );
    process.exitCode = 2;
    return;
  }
  const key = reviewIdLocatorKeyFromFingerprint(
    REVIEW_CHANNEL_CODE,
    request.accountId,
    identity.channelReviewIdFingerprint,
  );
  if (!key) {
    console.error("STOPPING: the backend identity is not a well-formed fingerprint; refusing to match on it.");
    process.exitCode = 2;
    return;
  }

  const asOf = civilDateParts(currentKstDate());
  if (!asOf) {
    console.error("Could not resolve the KST as-of date; refusing to compute a recency bucket.");
    process.exitCode = 2;
    return;
  }

  const statusDir = dirname(cfg.statusFile);
  const readySentinel = resolve(statusDir, "review-id-ready.ready");
  const confirmedSentinel = resolve(statusDir, "review-id-confirmed.ready");
  const mismatchSentinel = resolve(statusDir, "review-id-mismatch.ready");
  const rescanSentinel = resolve(statusDir, "review-id-rescan.ready");
  const stopSentinel = resolve(statusDir, "review-id-stop.ready");
  const allSentinels = [readySentinel, confirmedSentinel, mismatchSentinel, rescanSentinel, stopSentinel];
  mkdirSync(statusDir, { recursive: true });
  for (const s of allSentinels) removeSentinel(s);

  const runId = `idrun_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const network = armNetworkObserver(ctx, key.channelReviewIdFingerprint);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  let outcome: LocateOutcome | null = null;
  let exposure: Record<ReviewIdSource, number> | null = null;
  let pageStatePresence = false;
  let rowCount = 0;
  let rowsTruncated = true;
  let tokensTruncated = true;
  let scopeExpandedRows = 0;
  let outline: OutlineOutcome | null = null;
  let operatorConfirmed: boolean | null = null;
  let scanCount = 0;

  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    console.error(
      [
        "",
        "In the open browser: log in if needed, reach the review list, and FILTER so the target review row",
        "is visible. Do NOT click into the review — this probe only reads the list.",
        `When the target row is visible, create:  ${readySentinel}`,
        "",
      ].join("\n"),
    );
    if (!(await waitForFile(readySentinel, READY_TIMEOUT_MS))) {
      console.error("No readiness signal; ending without a probe.");
      process.exitCode = 2;
      return;
    }
    removeSentinel(readySentinel);

    const pages = ctx.pages();
    if (pages.length === 0) {
      console.error("The browser page was closed — retry with the window open.");
      process.exitCode = 2;
      return;
    }
    const activePage = pages[pages.length - 1] as Page;

    // 2/3) Scan, then decide. A wide review list renders columns lazily: the review-number column can sit
    // outside the rendered region, so its cells are simply not in the DOM until the operator brings that
    // region into view. A single scan cannot distinguish "this surface does not expose the id" from "the
    // part of the row carrying it had not rendered yet" — so the operator may adjust the view and rescan
    // within the SAME session. Rescanning is still read-only: the runtime never scrolls or clicks; the
    // operator does, and the runtime re-reads.
    for (;;) {
      scanCount += 1;
      const parsed = parseLadderResult(await evalOn<unknown>(activePage, inPageReviewIdLadder(asOf)));
      exposure = ladderExposure(parsed.candidates);
      rowCount = parsed.rowCount;
      rowsTruncated = parsed.rowsTruncated;
      tokensTruncated = parsed.tokensTruncated;
      scopeExpandedRows = parsed.scopeExpandedRows;
      pageStatePresence = parsed.pageStateFingerprints.includes(key.channelReviewIdFingerprint);

      // Exactly one row, or nothing. Secondary facts are asserted only after the identity matched.
      outcome = locateRowByReviewId(
        key,
        { channel: REVIEW_CHANNEL_CODE, sellerAccountId: request.accountId },
        parsed.candidates,
        { rating: identity.rating, recencyBucket: null, productRefFingerprint: null },
      );
      if (outcome.matched || scanCount >= MAX_SCANS) break;

      reportLadderEvidence(outcome, exposure, {
        rowCount,
        rowsTruncated,
        tokensTruncated,
        pageStatePresence,
        networkPresence: network.present,
        networkTruncated: network.truncated,
        scanCount,
      });
      console.error(
        [
          "",
          "You can adjust the VIEW and rescan in this same session — scroll the list horizontally so every",
          "column renders (the review-number column is often off to the right), widen the window, or change",
          "the page size. The runtime will not scroll or click; it only re-reads what you bring into view.",
          `  rescan → ${rescanSentinel}`,
          `  stop   → ${stopSentinel}`,
          "",
        ].join("\n"),
      );
      const again = await waitForEither(rescanSentinel, stopSentinel, RESCAN_TIMEOUT_MS);
      removeSentinel(rescanSentinel);
      removeSentinel(stopSentinel);
      if (again !== "a") break;
    }

    if (outcome.matched) {
      // Re-verifies the identity at that index before outlining: the list may have re-rendered between the
      // two evaluates, and a confirmation on the wrong row would be worse than no confirmation.
      outline = await evalOn<OutlineOutcome>(
        activePage,
        inPageOutlineRowAt(outcome.rowIndex, key.channelReviewIdFingerprint),
      );
      if (outline !== "outlined") {
        console.error("");
        console.error(
          outline === "row-changed"
            ? "THE LIST RE-RENDERED between the scan and the highlight, so the matched row can no longer be shown. Nothing was outlined; the match is NOT confirmable. Re-run without scrolling or re-filtering."
            : "THE MATCHED ROW IS GONE from the list (it shrank between the scan and the highlight). Nothing was outlined; the match is NOT confirmable.",
        );
      } else {
        console.error(
          [
            "",
            `IDENTITY MATCHED via the '${outcome.source}' rung — exactly 1 row.`,
            "That row is now OUTLINED IN GREEN in the browser. Confirm it is the target review.",
            `  - correct row  → ${confirmedSentinel}`,
            `  - WRONG row    → ${mismatchSentinel}`,
            "",
          ].join("\n"),
        );
        const answer = await waitForEither(confirmedSentinel, mismatchSentinel, CONFIRM_TIMEOUT_MS);
        operatorConfirmed = answer === null ? null : answer === "a";
        if (operatorConfirmed === false) {
          console.error("OPERATOR REPORTED THE WRONG ROW. The id match is NOT sound — recording it as a mismatch.");
        }
      }
    } else {
      await network.settle();
      reportLadderEvidence(outcome, exposure, {
        rowCount,
        rowsTruncated,
        tokensTruncated,
        pageStatePresence,
        networkPresence: network.present,
        networkTruncated: network.truncated,
        scanCount,
      });
      console.error("");
      console.error("Not falling back to the operator-calibrated flow: that mode asserts nothing about identity.");
    }
    await network.settle();
  } finally {
    for (const p of ctx.pages()) {
      await evalOn<number>(p as Page, IN_PAGE_ID_OUTLINE_TEARDOWN).catch(() => undefined);
    }
    for (const s of allSentinels) removeSentinel(s);
    await ctx.close();
  }

  // 4) The sanitized record.
  const record = buildProbeRecord({
    runId,
    outcome,
    exposure,
    rowCount,
    rowsTruncated,
    tokensTruncated,
    scopeExpandedRows,
    scanCount,
    pageStatePresence,
    networkPresence: network.present,
    networkTruncated: network.truncated,
    outline,
    operatorConfirmed,
  });
  console.log(JSON.stringify(record, null, 2));
  log("aw.review-id.probe", { matched: record.matched, source: record.matchedSource ?? "none" });

  try {
    const dir = resolve(collectorRoot, RUN_RECORD_REL_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${runId}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Deliberately not echoing the error: an fs error message carries the path, and the run record's
    // location is not something this tool prints. The record is a convenience; stdout above is the report.
    console.error("Could not persist the run record (the JSON above is the full result).");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A thrown error must NOT reach Node's default printer: Playwright's messages embed the target URL and the
  // evaluated in-page source (which carries the structural selectors), and a fetch/parse failure can carry a
  // response body. Neither may appear in this tool's output. The category is enough to act on.
  void main().catch((e: unknown) => {
    const category = e instanceof Error ? e.constructor.name : typeof e;
    console.error(`The probe failed (${category}). Details are suppressed to keep the run output sanitized.`);
    process.exitCode = 1;
  });
}
