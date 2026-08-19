/**
 * Live GUARDED CONTINUE — one human-attended run that performs EXACTLY ONE continue click,
 * and only when the no-click state proves it is safe (Milestone G, PR3).
 *
 *   set -a && . ./.env && set +a   # NAVER_REVIEW_URL + STORAGE_PROBE_SALT + channel +
 *                                  # NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT (REQUIRED here)
 *   npm run continue-account-store-same-session -- --i-understand-this-opens-live-naver
 *
 * Why this exists: the no-click classifier proved the recurring Commerce surface is a
 * single-account `reconnect-continue` screen with a stable continuation-card fingerprint and
 * exactly one safe continue control (READY_TO_CONTINUE). This run takes the ONE next action a
 * prepared runner will eventually automate — a single, structurally-verified, expected-match
 * continue click — then REPORTS the post-click state. It never automates NAVER-ID login, never
 * bypasses 2FA/CAPTCHA/security re-check, never triggers an export, never downloads/uploads,
 * never mutates a DB, and writes NO status record. The click itself lives entirely in the
 * `continueAtCardOnce` boundary; this CLI only orchestrates and prints sanitized output.
 *
 * FAIL CLOSED without: the approval flag, NAVER_REVIEW_URL, STORAGE_PROBE_SALT, or
 * NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT (the fingerprint gates the click to the EXPECTED
 * account — without it, nothing is clicked).
 *
 * READINESS: AUTO-READ by default — the explicit live-approval flag plus the strict
 * guarded-click gate are sufficient, so no human 'ready' is needed (open → settle → act; it
 * halts WITHOUT clicking unless READY_TO_CONTINUE and every guard passes). `--require-sentinel`
 * / `--sentinel` forces the old human-ready sentinel flow; `--no-sentinel` /
 * `--auto-read-after-hydration` remain accepted as auto-read aliases (the default).
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag.
 */
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { continueAtCardOnce } from "../naver/account-store-continue";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import type { OperatorConfirmAsk } from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";
import { actionBarrierRefusedMessage, barrierRefusedRecord, confirmActionBarrier } from "./operator-action-barrier";
import { pathToFileURL } from "node:url";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and reach the reconnect-continue screen.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/**
 * What the operator is asked to do, and confirm.
 *
 * It used to end with "just say \"ready\" and Claude creates it", which is exactly the channel that failed on
 * 2026-08-13: the assistant created the sentinel on the strength of a chat line the operator never wrote. The
 * instruction now names the one thing that advances this run, and it is not something a model can produce.
 */
const CONFIRM_ASK: OperatorConfirmAsk = {
  title: "NAVER 계정 재연결 계속",
  headline: "재연결 화면에서 멈춘 채로 확인해 주세요 — 계속을 직접 누르지 마세요.",
  lines: [
    "A browser window is open on NAVER. In that SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Reach the single-account Commerce RECONNECT / CONTINUE screen and STOP there —",
    "     do NOT click continue yourself. Leave the browser OPEN.",
    "",
    "Then press [현재 화면 확인] in the SellerOps confirmation tab — nothing else advances this run. It will then read",
    "the sanitized state and, ONLY if it is READY_TO_CONTINUE (fingerprint matches + exactly",
    "one safe control), perform EXACTLY ONE continue click and report the post-click state.",
    "Anything ambiguous halts WITHOUT clicking. It never selects a store, never triggers an",
    "export, captures nothing, records no status, and sends nothing to SellerOps.",
  ],
};

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER GUARDED CONTINUE — explicit per-run approval required.");
  console.error(" Performs EXACTLY ONE continue click, and ONLY on a fingerprint-matched");
  console.error(" READY_TO_CONTINUE reconnect card. No export, no capture, no upload, no status.");
  console.error(line);
}

/** Best-effort SPA settle before reading (the review route is an SPA). */
async function settleSpa(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* a busy SPA may never reach networkidle; the read does not depend on it */
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
    console.error("Set NAVER_REVIEW_URL to the review-management/export page URL first.");
    process.exit(2);
    return;
  }
  // Fail closed without the shared salt — candidate/card names are one-way hashed with it.
  if (!cfg.storageProbeSalt) {
    console.error(
      "Refusing to run the guarded continue without STORAGE_PROBE_SALT.\n" +
        "  - It one-way hashes candidate / card text; it is never printed or stored.",
    );
    process.exit(2);
    return;
  }
  // Fail closed without the expected continuation-card fingerprint — it gates the click to the
  // EXPECTED account's reconnect card. Absent → a continue is never allowed; nothing is clicked.
  if (!cfg.naverExpectedContinueCardFingerprint) {
    console.error(
      "Refusing to run the guarded continue without NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT.\n" +
        "  - It gates the single click to the EXPECTED account's reconnect-continue card.\n" +
        "  - Capture it first with `npm run classify-account-store-same-session` (report-only).",
    );
    process.exit(2);
    return;
  }
  const salt = cfg.storageProbeSalt;
  const expected = {
    expectedChannelCode: cfg.naverExpectedChannelCode,
    expectedStoreFingerprint: cfg.naverExpectedStoreFingerprint,
  };
  const expectedContinueCard = {
    expectedCardFingerprint: cfg.naverExpectedContinueCardFingerprint,
  };

  // Readiness flow: AUTO-READ is the DEFAULT — the explicit live-approval flag plus the strict
  // guarded-click gate are sufficient, so no human 'ready' is needed. --require-sentinel /
  // --sentinel forces the old human-ready sentinel flow; --no-sentinel / --auto-read-after-
  // hydration remain accepted as explicit auto-read (the default), for backward compatibility.
  const sentinelMode =
    (args.includes("--require-sentinel") || args.includes("--sentinel")) &&
    !args.includes("--no-sentinel") &&
    !args.includes("--auto-read-after-hydration");

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The confirmation surface is a SellerOps-owned tab in the SAME window. `entryPage` is the operator's own
  // page, captured before that tab existed — this run reads that page and never the surface.
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => false,
    timeoutMs: CONFIRM_TIMEOUT_MS,
  });
  const page = confirmHost.entryPage as unknown as Page;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce reconnect.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    if (sentinelMode) {
      confirmHost.announce(CONFIRM_ASK);
      const confirmation = await confirmHost.confirm(CONFIRM_ASK);
      if (confirmation.signal !== "ready") {
        console.error("No confirmation press — aborting without reading or clicking.");
        log("continue.account-store.aborted", { reason: confirmation.signal });
        return;
      }
      await settleSpa(page);
    } else {
      // Default: auto-read after SPA hydration. The live-approval flag + the strict guarded gate
      // are the safety boundary; the click still happens ONLY if READY_TO_CONTINUE + all guards.
      console.error("auto-read mode: will click only if READY_TO_CONTINUE and all guards pass.");
      console.error("If the page is login / 2FA / unknown / not-ready, it halts WITHOUT clicking.");
      await settleSpa(page);
    }

    // 2) The single chokepoint: the boundary gates, then performs at most ONE guarded click.
    // **THE ACTION BARRIER is passed INTO the boundary**, not raised before it. Asking here would ask on
    // whatever page happens to be open — on a cold profile that is the NAVER login form, so the ask would say
    // "the 계속 button on this screen" over a password field, and the confirmation tab would raise itself in
    // front of the seller mid-login. The boundary knows when a click is genuinely next; it asks then.
    const result = await continueAtCardOnce(page, ctx, expected, salt, expectedContinueCard, () =>
      confirmActionBarrier(confirmHost, {
        kind: "MARKETPLACE_CLICK",
        title: "계정 재연결 계속",
        headline: "이 화면의 '계속' 버튼을 SellerOps가 한 번 누르는 것을 허용하시겠습니까?",
        allows: [
          "재연결 화면의 '계속' 버튼을 정확히 한 번 누릅니다 (판매자님이 승인하신 계정의 카드일 때만).",
          "누른 뒤의 화면 상태를 한 번 읽어 보고합니다.",
        ],
        stillWillNot: "스토어를 선택하거나, 내보내기를 실행하거나, 어떤 값도 읽지 않습니다.",
      }),
    );
    if (result.outcome === "HALT_NOT_CONFIRMED") {
      console.error(actionBarrierRefusedMessage("MARKETPLACE_CLICK"));
      console.log(barrierRefusedRecord("MARKETPLACE_CLICK"));
      process.exitCode = 7;
    }

    // Sanitized JSON is the only stdout payload; all blocks are buckets/enums/booleans/hashes.
    console.log(
      JSON.stringify(
        {
          outcome: result.outcome,
          clicked: result.clicked,
          preClickVerdict: result.preClickVerdict,
          safeContinueControlCountBucket: result.safeContinueControlCountBucket,
          signals: result.preClick.signals,
          continuationCard: result.preClick.continuationCard,
          continueControls: result.preClick.continueControls,
          postClick: result.postClick ?? null,
        },
        null,
        2,
      ),
    );
    log("continue.account-store.done", {
      mode: sentinelMode ? "sentinel" : "auto-read",
      outcome: result.outcome,
      clicked: result.clicked,
      preClickVerdict: result.preClickVerdict,
      postClickVerdict: result.postClick?.verdict,
      reachedExportSurface: result.postClick?.reachedExportSurface,
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