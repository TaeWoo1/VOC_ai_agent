/**
 * Live NAVER reply-target **calibration** — read-only, NO submit, one human-attended run (Phase A).
 *
 *   set -a && . ./.env && set +a   # NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npx tsx instruments/calibration/calibrate-reply-target.ts -- --i-understand-this-opens-live-naver
 *
 * The seated operator logs in, navigates to the review-management list, expands 더보기 on the target review,
 * then clicks NUMBERED overlay badges to point out the target ROW and its BODY / DATE / RATING / REPLY-control
 * elements. The runtime records ONLY their relative structural index-paths (never a NAVER selector/class/text),
 * plus a structural page signature and a short expiry, into an owner-only 0600 artifact under `.reply-target/`.
 *
 * This is the READ half of the operator-assisted flow: it opens live NAVER (READ approval scope) but performs
 * NO mutation and NEVER clicks a NAVER control — the operator clicks our inert badge chips; a badge click is
 * preventDefault-ed and reaches no NAVER handler. It carries no submissionRef and no reply G6. Building and
 * verifying it is offline and hermetic (`main()` launches nothing on import).
 */
import { chmodSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import type { Page } from "playwright";
import {
  ROW_MAPPING_SCHEMA_VERSION,
  writeRowMapping,
  type ReplyRowMapping,
} from "../../src/action-window/reply-submission/reply-row-mapping-artifact";
import {
  IN_PAGE_CALIBRATION_INSTALL,
  IN_PAGE_CALIBRATION_READ,
  IN_PAGE_CALIBRATION_TEARDOWN,
  type CalibrationReadState,
} from "../../src/action-window/reply-submission/reply-calibrate-inpage";
import { inPagePageSignature } from "../../src/action-window/reply-submission/reply-row-inpage";
import { approvalRequiredMessage, hasLiveRunApproval } from "../../src/cli/live-run-approval";

const ROW_MAPPING_REL_PATH = ".reply-target/row-mapping.json";
const CALIBRATION_TTL_MS = 30 * 60_000; // short-lived: a calibration is only valid for the current sitting
const READY_SENTINEL_NAME = "calibrate-ready.ready";
const READY_TIMEOUT_MS = 20 * 60_000;
const CALIBRATION_TIMEOUT_MS = 20 * 60_000;
const POLL_INTERVAL_MS = 750;

/** Exit code: calibration did not complete (operator not ready, or not all elements selected, within the window). */
export const CALIBRATION_INCOMPLETE_EXIT_CODE = 5;

/**
 * Assemble the persisted mapping from the sanitized calibration read state + the live page signature. Returns
 * null when the state is incomplete (any element unselected) so a partial artifact is never written. `nowEpochMs`
 * is supplied by the caller (CLI boundary) — the artifact expires `CALIBRATION_TTL_MS` after it.
 */
export function mappingFromCalibration(
  state: CalibrationReadState,
  pageSignature: string,
  nowEpochMs: number,
): ReplyRowMapping | null {
  // Row-match abort rehearsal (Option 1): the operator designates the row in one click; only the row identity
  // (parentPath/rowTag/rowIndex) and bodyPath (for the cross-source EVIDENCE attempt) are needed. date/rating/
  // reply-control are not used by the calibrated-row locate, so they default to bodyPath (a valid, inert path).
  if (!state.done || !state.parentPath || !state.rowTag || state.rowIndex === null || !state.body) {
    return null;
  }
  return {
    schemaVersion: ROW_MAPPING_SCHEMA_VERSION,
    structuralPageSignature: pageSignature,
    expiresAtEpochMs: nowEpochMs + CALIBRATION_TTL_MS,
    parentPath: state.parentPath,
    rowTag: state.rowTag,
    rowIndex: state.rowIndex,
    ratingPath: state.body,
    datePath: state.body,
    bodyPath: state.body,
    replyControlPath: state.body,
  };
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER reply-target CALIBRATION — read-only, no-submit (Phase A). Requires per-run");
  console.error(" READ approval. A human logs in and CLICKS THE REAL elements (row, body, date, rating, reply);");
  console.error(" the runtime intercepts each click (nothing fires on NAVER) and records only structural paths —");
  console.error(" never a selector, text, rating, or date — and never clicks a NAVER control. Ctrl-C to abort.");
  console.error(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

async function waitForSentinel(path: string, timeoutMs: number): Promise<boolean> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / POLL_INTERVAL_MS));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  banner();
  if (!hasLiveRunApproval(args)) {
    console.error(approvalRequiredMessage());
    process.exitCode = 3;
    return;
  }
  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management page URL first.");
    process.exitCode = 2;
    return;
  }

  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const mappingPath = resolve(collectorRoot, ROW_MAPPING_REL_PATH);
  const statusDir = dirname(cfg.statusFile);
  const readySentinel = resolve(statusDir, READY_SENTINEL_NAME);
  mkdirSync(statusDir, { recursive: true });
  removeSentinel(readySentinel);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  const bindEval = (p: Page) => (p as unknown as { evaluate<R>(script: string): Promise<R> }).evaluate.bind(p);
  let evalStr = bindEval(page);
  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
    console.error(
      [
        "",
        "A browser window is open on NAVER. In that SAME window:",
        "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
        "  2) Navigate to the review-management list and EXPAND 더보기 on your target review.",
        `  3) When ready, create this file to start calibration:  ${readySentinel}`,
        "",
        "Then CLICK THE REVIEW BODY once — the whole review row is designated in one click. An on-screen banner",
        "guides you; the click is intercepted so nothing fires on NAVER.",
        "",
      ].join("\n"),
    );
    if (!(await waitForSentinel(readySentinel, READY_TIMEOUT_MS))) {
      console.error("No readiness signal within the window; ending without writing a calibration artifact.");
      process.exitCode = CALIBRATION_INCOMPLETE_EXIT_CODE;
      return;
    }

    // Re-acquire the ACTIVE page: the operator may have opened a new tab or navigated while finding the review,
    // leaving the launch-time page handle stale (a closed page would otherwise crash the overlay install).
    const openPages = ctx.pages();
    if (openPages.length === 0) {
      console.error("The browser page was closed before calibration could start — keep the window open and retry.");
      process.exitCode = CALIBRATION_INCOMPLETE_EXIT_CODE;
      return;
    }
    evalStr = bindEval(openPages[openPages.length - 1] as Page);

    await evalStr<boolean>(IN_PAGE_CALIBRATION_INSTALL);
    console.error("Calibration ready. Click the REVIEW BODY once to designate the target row…");

    let state: CalibrationReadState | null = null;
    const maxChecks = Math.max(1, Math.ceil(CALIBRATION_TIMEOUT_MS / POLL_INTERVAL_MS));
    let lastStep = "";
    let lastError: string | null = null;
    let diagPrinted = false;
    for (let i = 0; i < maxChecks; i += 1) {
      state = await evalStr<CalibrationReadState | null>(IN_PAGE_CALIBRATION_READ);
      if (state && state.step !== lastStep) {
        console.error(`  … select: ${state.step}`);
        lastStep = state.step;
      }
      // Sanitized structural evidence of the clicked row (tags/repetition/text-length only) for verification.
      if (state && state.rowDiag && !diagPrinted) {
        console.error(`  row-structure: ${JSON.stringify(state.rowDiag)}`);
        diagPrinted = true;
      }
      if (state && state.lastError && state.lastError !== lastError) {
        console.error(`  ! ${state.lastError} — click a different element (inside the highlighted row).`);
        lastError = state.lastError;
      }
      if (state && state.done) break;
      await sleep(POLL_INTERVAL_MS);
    }

    const pageSignature = await evalStr<string>(inPagePageSignature());
    const mapping = state ? mappingFromCalibration(state, pageSignature, Date.now()) : null;
    if (!mapping) {
      console.error("Calibration did not complete (not all elements selected); no artifact written.");
      process.exitCode = CALIBRATION_INCOMPLETE_EXIT_CODE;
      return;
    }
    writeRowMapping(mappingPath, mapping, { existsSync, mkdirSync, writeFileSync, chmodSync, renameSync });
    // Print ONLY a non-sensitive confirmation — never the paths, indices, or the page signature.
    console.error(`Wrote an owner-only, page-bound calibration artifact to ${mappingPath} (expires in 30 min).`);
    console.error("Proceed to the escalation checkpoint: mint the bundle, then run the reply CLI (it re-checks page + cross-source).");
    log("reply.target.calibrated", {});
  } finally {
    await evalStr<boolean>(IN_PAGE_CALIBRATION_TEARDOWN).catch(() => undefined);
    removeSentinel(readySentinel);
    await ctx.close();
  }
}

// Run ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
