/**
 * Live, SAME-SESSION classify-only discovery — one human-attended run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run discover-same-session -- --i-understand-this-opens-live-naver
 *
 * Unlike `discover` (separate --login then a later --discover), this keeps ONE
 * persistent-context lifetime: open NAVER → human completes the NAVER-ID /
 * commerce-ID / SmartStore Center flow → presses Enter → the SAME context
 * re-checks the session and classifies the export mechanism. This avoids the
 * commerce-session loss that happens when Chrome is restarted between login and
 * discovery (see src/cli/same-session.ts). Always classify-only: no SellerOps
 * login/channel/upload, no saveAs, no backend; LAST_SUCCESS is impossible.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag.
 */
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { checkLiveSession } from "../naver/session-check";
import { runExport } from "../naver/review-export";
import { launchNaverContext, type PwPage } from "../profile";
import { writeStatus, type SessionState } from "../status";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import {
  classifyOnlyStatus,
  proceedAfterConfirmation,
  SAME_SESSION_CONFIRM_PROMPT,
  type ConfirmationResult,
} from "./same-session";

// The human may need to clear 2FA/CAPTCHA and the commerce-ID flow; give them
// plenty of time, but never hang forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
// Best-effort SPA settle before reading the session (the review route is an SPA).
const SETTLE_TIMEOUT_MS = 15_000;

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER same-session discovery — explicit per-run approval required.");
  console.error(" A human completes login/2FA/CAPTCHA in the SAME window; the collector");
  console.error(" never types credentials, never bypasses auth, never writes to NAVER.");
  console.error(line);
}

/** Live I/O: wait for a single Enter keypress, or resolve "timeout". Not unit-tested. */
function waitForEnter(timeoutMs: number): Promise<ConfirmationResult> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const finish = (result: ConfirmationResult): void => {
      clearTimeout(timer);
      stdin.off("data", onData);
      try {
        stdin.pause();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    const onData = (): void => finish("confirmed");
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    try {
      stdin.resume();
    } catch {
      /* ignore */
    }
    stdin.once("data", onData);
  });
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

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const realPage = ctx.pages()[0] ?? (await ctx.newPage());
  const page = realPage as unknown as PwPage;
  try {
    // 1) Open the review route — this typically redirects to login / commerce select.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Hand off to the human IN THE SAME CONTEXT; wait for explicit confirmation.
    console.error(SAME_SESSION_CONFIRM_PROMPT);
    const confirmation = await waitForEnter(CONFIRM_TIMEOUT_MS);
    if (!proceedAfterConfirmation(confirmation)) {
      writeStatus(cfg.statusFile, {
        state: "SESSION_EXPIRED",
        detail: "no confirmation within timeout; aborted before discovery",
        updatedAt: now(),
      });
      log("run.halted", { state: "SESSION_EXPIRED", reason: "confirmation-timeout" });
      return;
    }

    // 3) Re-navigate in the SAME context (session now established by the human),
    //    then best-effort wait for the SPA to settle before reading the session.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
    await realPage.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {
      /* best-effort; the session check below is the source of truth */
    });

    // 4) Session check — never proceed to export on an ambiguous/invalid session.
    const session: SessionState = await checkLiveSession(page);
    if (session !== "LOGGED_IN") {
      const { state, detail } = classifyOnlyStatus(session);
      writeStatus(cfg.statusFile, { state, detail, updatedAt: now() });
      log("run.halted", { state });
      return;
    }

    // 5) Classify-only export discovery — classify sync/async/blocked; NEVER saveAs,
    //    NEVER upload. A captured sync export maps to COLLECTING, never LAST_SUCCESS.
    const { outcome } = await runExport(page, cfg.downloadDir, { classifyOnly: true });
    const { state, detail } = classifyOnlyStatus(session, outcome);
    writeStatus(cfg.statusFile, { state, detail, updatedAt: now() });
    log("run.done", { state, outcome, classifyOnly: true });
  } finally {
    await ctx.close();
  }
}

void main();
