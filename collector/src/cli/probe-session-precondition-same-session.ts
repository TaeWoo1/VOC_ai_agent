/**
 * Live, READ-ONLY NAVER session-PRECONDITION probe — one human-attended diagnostic run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npx tsx src/cli/probe-session-precondition-same-session.ts -- --i-understand-this-opens-live-naver
 *
 * This is the R4 §8-4 "read-only live session-precondition probe" — the ONLY permitted pre-pilot
 * live contact. It answers exactly ONE question and then STOPS: is the seller-center session
 * usable (READY), or does it need the human first (reconnect / login / auth challenge / ambiguous)?
 * It is strictly LESS than an Action Window run: it never evaluates export-target readiness, never
 * locates/highlights a control, never observes a click, never waits for or saves a download, never
 * quarantines/ingests/uploads anything, and never enters the engine/session/downstream. It writes
 * no status record, starts no backend, touches no DB, and sends nothing to SellerOps. It only reads
 * the page the human left and prints the sanitized precondition — a boolean, the coarse verdict, a
 * reserved blocker code, and a coarse URL category. No raw URL/HTML/content/identity is emitted.
 *
 * It reuses the same ONE-persistent-context + sentinel-file flow as `probe-same-session.ts` (the
 * Bash tool's stdin cannot reliably deliver Enter): open NAVER → the human completes
 * login / 2FA / CAPTCHA / Commerce account+store selection and lands on the page to check → they
 * signal readiness by creating the printed sentinel file → the SAME context reads the page AS LEFT,
 * classifies the session verdict READ-ONLY (`checkLiveSessionVerdict`), maps it to the shared
 * precondition contract (`naverSessionPrecondition`), prints the result, and exits.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag, exactly like the other
 * live CLIs. Standing state: NAVER live work is PAUSED. Building/verifying this entrypoint is
 * OFFLINE; running it live is a separate, per-run operator-approved step (R4 gates G2/G3/G6).
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { checkLiveSessionVerdict, urlCategory } from "../naver/session-check";
import { naverSessionPrecondition } from "../action-window/naver-session-precondition";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { sentinelPathFor } from "./probe-sentinel";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give them plenty of
// time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

/**
 * Prompt shown after the browser opens. Session-precondition specific — it promises ONLY a
 * read of the session state, never an export classification, click, or capture.
 */
const PROBE_CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Reach the SmartStore Center review-management page you would export from",
  "     (or leave a reconnect / login / auth-challenge screen up if that is where",
  "     you land — the probe reports whichever it is).",
  "  3) Leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  "just say \"ready\" and Claude creates it). The collector is polling for it and will",
  "then read ONLY the sanitized session precondition in this same window: is the",
  "session READY, or does it need you first. It never evaluates the export target,",
  "locates or highlights a control, acts on the page, saves a file, hands data",
  "downstream, writes a status record, starts a backend, or sends anything to",
  "SellerOps. (Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER session-PRECONDITION probe — explicit per-run approval required.");
  console.error(" Read-only: a human logs in; the collector reports ONLY whether the session is");
  console.error(" READY vs a fail-closed blocker. No export, no click, no download, no status");
  console.error(" write, nothing sent to SellerOps. It stops at the session check. Ctrl-C to abort.");
  console.error(line);
}

/** Best-effort SPA settle before reading the session (the review route is an SPA). */
async function settleSpa(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* best-effort — read the page as left even if it never reaches networkidle */
  }
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
 * Poll for the sentinel file up to `timeoutMs`. Returns true once it appears, false on timeout.
 * The caller clears any stale sentinel BEFORE calling this, so a hit only reflects a post-startup
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

  // Single source of truth for the continuation file; clear any stale sentinel BEFORE waiting so a
  // leftover from a crashed run can never auto-proceed.
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
    console.error("  Sentinel file (create this when ready):");
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
      console.error("No sentinel within the timeout; aborting without reading the page.");
      log("probe.aborted", { reason: "sentinel-timeout" });
      return;
    }

    // 3) Read the page AS THE HUMAN LEFT IT (no re-navigation). Session-precondition ONLY: classify
    //    the verdict read-only and map it to the shared READY-vs-blocker contract, then STOP.
    await settleSpa(page);
    const verdict = await checkLiveSessionVerdict(page);
    const precondition = naverSessionPrecondition(verdict);
    const result = { ...precondition, urlCategory: urlCategory(page.url()) };

    // Sanitized JSON is the only stdout payload; the log echoes the same scalars.
    console.log(JSON.stringify(result, null, 2));
    log("probe.precondition", {
      ready: precondition.ready,
      verdict,
      ...(precondition.ready ? {} : { blockerCode: precondition.blockerCode }),
    });
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
