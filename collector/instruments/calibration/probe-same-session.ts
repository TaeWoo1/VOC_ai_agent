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
import type { Page } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { extractProbeSignals, type HydrationWaitResult } from "../../src/naver/session-probe";
import { launchNaverContext } from "../../src/profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "../../src/cli/live-run-approval";
import type { OperatorConfirmAsk } from "../../src/cli/operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { buildSessionProbeMeta, emitSessionProbe } from "../../src/cli/same-session";
import { pathToFileURL } from "node:url";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give them
// plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/**
 * What the operator is asked to do, and confirm. Deliberately NOT the same-session discovery prompt — that one
 * promises to "classify the export mechanism", which this read-only probe never does.
 *
 * It used to end with "just say \"ready\" and Claude creates it", which is precisely the channel that failed on
 * 2026-08-13: the assistant created the sentinel on the strength of a chat line the operator never wrote. The
 * instruction now names the one thing that advances this probe, and it is not something a model can produce.
 */
const PROBE_ASK: OperatorConfirmAsk = {
  title: "NAVER 세션 판독",
  headline: "읽히기를 원하는 화면에 직접 도착한 뒤 확인해 주세요.",
  lines: [
    "열린 NAVER 창에서, 같은 창 안에서:",
    "  1) NAVER 로그인(그리고 2단계 인증 · CAPTCHA)을 직접 완료하세요.",
    "  2) 읽히기를 원하는 화면으로 이동하세요 — 리뷰 관리 화면, 계정/스토어 재연결 화면,",
    "     로그인 화면, 인증 요구 화면 중 무엇이든 괜찮습니다.",
    "  3) 창을 열어 두세요.",
    "",
    "확인을 누르시면 SellerOps가 그 창에서 SANITIZED 세션 신호만 한 번 읽습니다. 내보내기를",
    "분류하거나 실행하지 않고, 파일을 저장하지 않으며, 상태 기록도 쓰지 않고, 아무것도 전송하지",
    "않습니다.",
  ],
};

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

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The confirmation surface is a SellerOps-owned tab in the SAME window. `entryPage` is the operator's own
  // page, captured before that tab existed — this probe reads it and nothing else.
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => false,
    timeoutMs: CONFIRM_TIMEOUT_MS,
  });
  const page = confirmHost.entryPage as unknown as Page;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce select.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Hand off to the human IN THE SAME CONTEXT, and wait for a press they alone can produce.
    confirmHost.announce(PROBE_ASK);
    const confirmation = await confirmHost.confirm(PROBE_ASK);
    if (confirmation.signal !== "ready") {
      // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
      console.error("No confirmation press — aborting without reading the page.");
      log("probe.aborted", { reason: confirmation.signal });
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