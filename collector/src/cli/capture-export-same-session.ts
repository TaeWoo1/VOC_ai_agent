/**
 * Live same-session SYNC CAPTURE — one human-attended, single-click export run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run capture-export-same-session -- --i-understand-this-opens-live-naver
 *
 * Why this exists: the cold auto-navigation full-capture path (`discover-export
 * --discover`) opens a FRESH context and programmatically navigates to the review
 * route, which NAVER Commerce answers with a reconnect / account-selection
 * interstitial (`RECONNECT_REQUIRED`) — so the export click → download → upload leg
 * has never actually run. This CLI is the validation BRIDGE: it mirrors the read-only
 * `classify-export-same-session` sentinel flow, but after the human has logged in,
 * selected the account/store, and navigated to the loaded export page IN THE SAME
 * session, it performs ONE guarded sync capture on that page and uploads it to the
 * local dev backend. It proves the real capture leg on the already-proven same-session
 * state instead of a cold re-navigation. It is NOT the final unattended path.
 *
 * STRICT GUARDS — the click only ever happens when ALL hold:
 *   - the five-state verdict is `LOGGED_IN` (`checkLiveSessionVerdict`),
 *   - the no-click plan (`planExportAction`) says `SYNC_DOWNLOAD`, no async marker,
 *     exactly one actionable candidate AND one trigger selector (`decideCaptureGate`),
 *   - `runExport({ strictSingleCandidate: true })` re-classifies and refuses anything
 *     but a single sync control, clicking once with no fallback loop.
 * Any other shape HALTS with an honest status and never clicks. Two independent checks
 * must both say "single sync control" before a single download is triggered.
 *
 * CONTINUATION: like the other same-session CLIs it does NOT read a terminal keypress
 * (the harness can't reliably deliver Enter). It polls for the SAME sentinel file whose
 * exact absolute path it prints; create that file when ready. Run only ONE same-session
 * CLI at a time — they share the sentinel path.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext } from "playwright";
import { loadConfig, type CollectorConfig } from "../config";
import { log } from "../log";
import { planExportAction } from "../naver/export-classify";
import { waitForSpaHydration } from "../naver/hydration";
import { checkLiveSessionVerdict } from "../naver/session-check";
import { runExport } from "../naver/review-export";
import { launchNaverContext, type PwPage } from "../profile";
import { decideState, writeStatus, type RunSignals } from "../status";
import { login, resolveChannelId, uploadReviewFile, UploadError } from "../upload";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { decideCaptureGate } from "./same-session";
import { sentinelPathFor } from "./probe-sentinel";

// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give
// them plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

/** Prompt shown after the browser opens. The exact sentinel path is printed below it. */
const CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Select the account / store and enter the SmartStore Center review-management",
  "     / export page, with the export controls visibly loaded.",
  "  3) Leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  "just say \"ready\" and Claude creates it). The collector is polling for it and will",
  "then verify the session + export layout and, ONLY for a single unambiguous sync",
  "control, click it ONCE, capture the download, and upload it to the LOCAL dev",
  "backend. If anything is ambiguous it halts WITHOUT clicking. (Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER same-session capture — explicit per-run approval required.");
  console.error(" A human logs in; the collector clicks at most ONE sync export control,");
  console.error(" captures one file, and uploads it to the LOCAL dev backend only.");
  console.error(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Best-effort: remove the sentinel if present. Used at startup (clear stale) and cleanup. */
function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort — a leftover is cleared by the next run's startup unlink anyway */
  }
}

/**
 * Poll for the sentinel file up to `timeoutMs`. Returns true once it appears, false
 * on timeout. Bounded by a fixed iteration count (no wall-clock read). The caller
 * clears any stale sentinel BEFORE calling this, so a hit only ever reflects a
 * post-startup creation.
 */
async function waitForSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return true;
    await sleep(intervalMs);
  }
  return existsSync(path);
}

/**
 * Past the gate (`LOGGED_IN` + single sync control): trigger the ONE guarded capture and,
 * on a real CAPTURED file, upload it through the existing offline-core client. This is the
 * ONLY path that clicks/captures. `strictSingleCandidate` makes the one-click bound
 * structural inside `runExport`. Mirrors `discover-export.ts:doDiscoverFullCapture`, minus
 * the cold-navigation front-end.
 */
async function captureAndUpload(
  page: PwPage,
  cfg: CollectorConfig,
  now: () => string,
): Promise<void> {
  const base: RunSignals = { paired: true, session: "LOGGED_IN" };

  const { outcome, filePath } = await runExport(page, cfg.downloadDir, {
    classifyOnly: false,
    strictSingleCandidate: true,
  });

  if (outcome !== "CAPTURED" || !filePath) {
    const state = decideState({ ...base, exportOutcome: outcome });
    writeStatus(cfg.statusFile, { state, detail: `export outcome: ${outcome}`, updatedAt: now() });
    log("run.done", { state, outcome });
    return;
  }

  // Sync capture → upload through the existing offline-core client (no new path). The
  // captured filename can carry store/date — it is used only as the on-disk path and the
  // upload basename; the status detail is row counts only, never the filename.
  let uploadOutcome: "OK" | "FAILED" = "OK";
  let detail = "";
  try {
    const token = await login(cfg.baseUrl, cfg.email, cfg.password);
    const channelId = await resolveChannelId(cfg.baseUrl, token, cfg.naverChannelCode);
    const result = await uploadReviewFile(cfg.baseUrl, token, channelId, filePath);
    detail = `inserted ${result.successRows}, skipped ${result.skippedRows}, failed ${result.failedRows}`;
  } catch (error) {
    uploadOutcome = "FAILED";
    detail = `upload failed at ${error instanceof UploadError ? error.stage : "unknown"}`;
  }
  const state = decideState({ ...base, exportOutcome: "CAPTURED", uploadOutcome });
  writeStatus(cfg.statusFile, {
    state,
    detail,
    lastCollectedAt: uploadOutcome === "OK" ? now() : undefined,
    updatedAt: now(),
  });
  log("run.done", { state });
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasLiveRunApproval(args)) {
    console.error(approvalRequiredMessage());
    process.exit(3);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management/export page URL first.");
    process.exit(2);
    return;
  }
  const now = (): string => new Date().toISOString();

  // Single source of truth for the continuation file; clear any stale sentinel BEFORE
  // waiting so a leftover from a crashed run can never auto-proceed.
  const sentinelPath = sentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as unknown as PwPage;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce select.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Hand off to the human IN THE SAME CONTEXT; wait for the sentinel (not stdin).
    console.error(CONFIRM_PROMPT);
    console.error("");
    console.error(`  Sentinel file (create this when ready):`);
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      // Never act on a half-loaded page on a timeout — abort cleanly without reading or clicking.
      console.error("No sentinel within the timeout; aborting without reading the page.");
      log("capture.aborted", { reason: "sentinel-timeout" });
      return;
    }

    // 3) Read the page AS THE HUMAN LEFT IT (no re-navigation — a re-nav can reset the SPA),
    //    giving the SPA a bounded chance to hydrate before the verdict + plan are read.
    const hydration = await waitForSpaHydration(page);
    log("session.hydration", { result: hydration });
    const verdict = await checkLiveSessionVerdict(page);
    const plan = planExportAction(await page.content());

    // 4) The single chokepoint: only an unambiguous single sync control on a LOGGED_IN
    //    session proceeds to the click. Everything else halts with an honest status.
    const gate = decideCaptureGate(verdict, plan);
    if (!gate.proceed) {
      writeStatus(cfg.statusFile, { state: gate.state, detail: gate.detail, updatedAt: now() });
      log("run.halted", { state: gate.state });
      return;
    }

    await captureAndUpload(page, cfg, now);
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
