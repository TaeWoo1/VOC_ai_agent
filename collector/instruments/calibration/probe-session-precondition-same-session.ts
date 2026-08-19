/**
 * Live, READ-ONLY NAVER session-PRECONDITION probe — one human-attended diagnostic run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npx tsx instruments/calibration/probe-session-precondition-same-session.ts -- --i-understand-this-opens-live-naver
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
import type { Page } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { checkLiveSessionVerdict, urlCategory } from "../../src/naver/session-check";
import { naverSessionPrecondition } from "../../src/action-window/naver-session-precondition";
import { launchNaverContext } from "../../src/profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "../../src/cli/live-run-approval";
import type { OperatorConfirmAsk } from "../../src/cli/operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { pathToFileURL } from "node:url";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give them plenty of
// time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/**
 * What the operator is asked to do, and confirm.
 *
 * It used to end with "just say \"ready\" and Claude creates it", which is exactly the channel that failed on
 * 2026-08-13: the assistant created the sentinel on the strength of a chat line the operator never wrote. The
 * instruction now names the one thing that advances this run, and it is not something a model can produce.
 */
const PROBE_ASK: OperatorConfirmAsk = {
  title: "NAVER 세션 전제조건 판독",
  headline: "읽히기를 원하는 화면에 도착한 뒤 확인해 주세요.",
  lines: [
    "A browser window is open on NAVER. In that SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Reach the SmartStore Center review-management page you would export from",
    "     (or leave a reconnect / login / auth-challenge screen up if that is where",
    "     you land — the probe reports whichever it is).",
    "  3) Leave the browser OPEN.",
    "",
    "Then press [현재 화면 확인] in the SellerOps confirmation tab — nothing else advances this run. It will",
    "then read ONLY the sanitized session precondition in this same window: is the",
    "session READY, or does it need you first. It never evaluates the export target,",
    "locates or highlights a control, acts on the page, saves a file, hands data",
    "downstream, writes a status record, starts a backend, or sends anything to",
    "SellerOps. (Ctrl-C to abort.)",
  ],
};

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

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The confirmation surface is a SellerOps-owned tab in the SAME window. `entryPage` is the operator's own
  // page, captured before that tab existed — this run reads that page and never the surface.
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => false,
    timeoutMs: CONFIRM_TIMEOUT_MS,
  });
  const page = confirmHost.entryPage as unknown as Page;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce select.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    confirmHost.announce(PROBE_ASK);
    const confirmation = await confirmHost.confirm(PROBE_ASK);
    if (confirmation.signal !== "ready") {
      // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
      console.error("No confirmation press — aborting without reading the page.");
      log("probe.aborted", { reason: confirmation.signal });
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
    await ctx.close();
  }
}

// Run only when executed directly, NEVER on import — importing must have no side effects.
// Before R2 this called `main()` at module top level, so merely importing the file (a test, a tooling
// script, an editor's auto-import) ran the whole entrypoint, argv parse and all.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}