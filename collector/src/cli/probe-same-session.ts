/**
 * Live, READ-ONLY same-session verdict probe — one human-attended diagnostic run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run probe-same-session -- --i-understand-this-opens-live-naver
 *
 * Why this exists: bridging an interactive `--login` to a later `probe-session` across
 * two SEPARATE browser launches loses the NAVER/Commerce session on restart, so the
 * probe always re-reads a login page. This keeps ONE persistent-context lifetime: open
 * NAVER -> the human completes login / 2FA / CAPTCHA / Commerce account+store selection
 * and navigates to whatever page they want read -> signals readiness -> the SAME context
 * reads the page AS LEFT and prints the sanitized structural signals (including the
 * five-state `sessionVerdict`).
 *
 * CONTINUATION: it does NOT read a terminal keypress (the Bash tool's stdin does not
 * reliably deliver Enter). Instead it polls for a SENTINEL FILE whose exact absolute path
 * it prints; the operator (or Claude on their behalf) creates that file when ready. See
 * `probe-sentinel.ts` for the shared path.
 *
 * This is a pure DIAGNOSTIC: it is structurally separate from the classify-only discovery
 * flow. It does not reach the export/capture path at all — it never classifies, triggers,
 * clicks, or captures an export, saves no export file, starts no backend, touches no DB,
 * writes no status record, and sends nothing to SellerOps. It only reads the page and
 * emits booleans / bucketed counts / category enums. LIVE-ONLY — refuses to act without
 * the explicit per-run approval flag, exactly like the other live CLIs.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { extractProbeSignals, type HydrationWaitResult } from "../naver/session-probe";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { sentinelPathFor } from "./probe-sentinel";
import { buildSessionProbeMeta, emitSessionProbe } from "./same-session";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give them
// plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

/**
 * Prompt shown after the browser opens. Deliberately NOT the same-session discovery
 * prompt — that one promises to "classify the export mechanism", which this read-only
 * probe never does. The exact sentinel path is printed separately, below the prompt.
 */
const PROBE_CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Navigate to whichever page you want read — the SmartStore Center review",
  "     page, an account/store reconnect screen, the login page, or an auth-",
  "     challenge page.",
  "  3) Leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  "just say \"ready\" and Claude creates it). The collector is polling for it and will",
  "then read ONLY sanitized session signals in this same window. It never classifies,",
  "triggers, clicks, or captures an export, saves no export file, writes no status",
  "record, starts no backend, and sends nothing to SellerOps. (Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER same-session verdict probe — explicit per-run approval required.");
  console.error(" Read-only: a human logs in; the collector reads SANITIZED structural signals");
  console.error(" only. No export, no status write, nothing sent to SellerOps. Ctrl-C to abort.");
  console.error(line);
}

/** Best-effort SPA settle before reading the session (the review route is an SPA). */
async function settleSpa(page: Page): Promise<HydrationWaitResult> {
  try {
    await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
    return "hydrated";
  } catch {
    return "timeout";
  }
}

/** Read live DOM scalars (readyState + SPA-root child count) without echoing any content. */
async function readDomScalars(page: Page): Promise<{ readyState: string; appRootChildCount: number }> {
  return page.evaluate(() => {
    const root = document.querySelector("#app, #root, #__next, [data-reactroot]");
    return {
      readyState: document.readyState,
      appRootChildCount: root ? root.childElementCount : -1,
    };
  });
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
 * Poll for the sentinel file up to `timeoutMs`. Returns true once it appears, false on
 * timeout. Bounded by a fixed iteration count (no wall-clock read). The caller clears any
 * stale sentinel BEFORE calling this, so a hit here only ever reflects a post-startup
 * creation.
 */
async function waitForSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return true;
    await sleep(intervalMs);
  }
  return existsSync(path);
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
    console.error("Set NAVER_REVIEW_URL to the review-management page URL first.");
    process.exit(2);
    return;
  }
  const wantProbe = emitSessionProbe(args);

  // Single source of truth for the continuation file; clear any stale sentinel BEFORE
  // waiting so a leftover from a crashed run can never auto-proceed.
  const sentinelPath = sentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce select.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Hand off to the human IN THE SAME CONTEXT; wait for the sentinel (not stdin).
    console.error(PROBE_CONFIRM_PROMPT);
    console.error("");
    console.error(`  Sentinel file (create this when ready):`);
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
      console.error("No sentinel within the timeout; aborting without reading the page.");
      log("probe.aborted", { reason: "sentinel-timeout" });
      return;
    }

    // 3) Read the page AS THE HUMAN LEFT IT (no re-navigation — a re-nav can reset the
    //    SPA and lose what they reached). Best-effort settle, then sanitized read.
    const hydrationWaitResult = await settleSpa(page);
    const { readyState, appRootChildCount } = await readDomScalars(page);
    const signals = extractProbeSignals({
      url: page.url(),
      html: await page.content(),
      readyState,
      appRootChildCount: appRootChildCount >= 0 ? appRootChildCount : undefined,
      hydrationWaitResult,
    });

    // Sanitized JSON is the only stdout payload; the log echoes the same scalars.
    console.log(JSON.stringify(signals, null, 2));
    log("probe.done", { ...signals });
    if (wantProbe) log("session.probe", buildSessionProbeMeta("same-session-after-sentinel", signals));
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
