/**
 * Live, STRICT NO-CLICK export classifier — one human-attended diagnostic run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run classify-export-same-session -- --i-understand-this-opens-live-naver
 *
 * Why this exists: the existing same-session discovery classifies the export by
 * actually TRIGGERING it — its "classify-only" path still clicks the control and
 * waits for the download stream (it only skips persisting the file). This CLI proves
 * the export LAYOUT (sync / async / unrecognized) under a strict no-click boundary:
 * it reads the page the human reached and decides sync-vs-async from the rendered
 * structure ALONE — it never clicks a control, never waits for a download, never
 * captures or persists a file, writes no status record, starts no backend, touches
 * no DB, and sends nothing to SellerOps.
 *
 * It is structurally separate from the trigger/capture path: it never imports the
 * export-capture module, only the PURE planner (`planExportAction`) plus the
 * sanitized structural probes. Every read is READ-ONLY (text / attribute /
 * visibility scan only) and the only output is sanitized booleans / bucketed counts
 * / category enums — never a selector, raw URL, raw HTML, or any account / store /
 * product / review / customer datum.
 *
 * CONTINUATION: like the other same-session probes it does NOT read a terminal
 * keypress (the harness can't reliably deliver Enter). It polls for the SAME
 * sentinel file whose exact absolute path it prints; create that file when ready.
 * Run only ONE probe/classifier at a time — they share the sentinel path.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag.
 */
import type { Page } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { planExportAction } from "../../src/naver/export-classify";
import { extractExportProbeSignals } from "../../src/naver/export-probe";
import { extractProbeSignals, type HydrationWaitResult } from "../../src/naver/session-probe";
import { launchNaverContext } from "../../src/profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "../../src/cli/live-run-approval";
import type { OperatorConfirmAsk } from "../../src/cli/operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { pathToFileURL } from "node:url";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give
// them plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/**
 * What the operator is asked to do, and confirm.
 *
 * It used to end with "just say \"ready\" and Claude creates it", which is exactly the channel that failed on
 * 2026-08-13: the assistant created the sentinel on the strength of a chat line the operator never wrote. The
 * instruction now names the one thing that advances this run, and it is not something a model can produce.
 */
const CONFIRM_ASK: OperatorConfirmAsk = {
  title: "NAVER 내보내기 레이아웃 분류",
  headline: "내보내기 화면에 직접 도착한 뒤 확인해 주세요.",
  lines: [
    "A browser window is open on NAVER. In that SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Navigate to the SmartStore Center review-management / export page and, if you",
    "     can, make the export controls visibly loaded.",
    "  3) Leave the browser OPEN.",
    "",
    "Then press [현재 화면 확인] in the SellerOps confirmation tab — nothing else advances this run. It will",
    "then read ONLY sanitized structural signals and classify the export LAYOUT. It",
    "never clicks a control, never waits for a file, captures nothing, writes no status",
    "record, starts no backend, and sends nothing to SellerOps. (Ctrl-C to abort.)",
  ],
};

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER no-click export classifier — explicit per-run approval required.");
  console.error(" Read-only: a human logs in; the collector reads SANITIZED structural signals");
  console.error(" and classifies the export layout. No click, no file, no status write.");
  console.error(line);
}

/** Best-effort SPA settle before reading (the review route is an SPA). */
async function settleSpa(page: Page): Promise<HydrationWaitResult> {
  try {
    await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
    return "hydrated";
  } catch {
    return "timeout";
  }
}

/** Top-document DOM scalars for the session gate (readyState + SPA-root child count). */
async function readDomScalars(page: Page): Promise<{ readyState: string; appRootChildCount: number }> {
  return page.evaluate(() => {
    const root = document.querySelector("#app, #root, #__next, [data-reactroot]");
    return {
      readyState: document.readyState,
      appRootChildCount: root ? root.childElementCount : -1,
    };
  });
}

/**
 * READ-ONLY export-candidate scan of the top document. Counts interactive elements
 * whose accessible text reads like an export/download control (total / visible /
 * enabled) and how many elements host an OPEN shadow root. It only READS text /
 * attributes / geometry — it never acts on an element, and it never returns the
 * matched text. Feeds the sanitized export-probe signals.
 */
async function scanExportCandidates(
  page: Page,
): Promise<{ total: number; visible: number; enabled: number; shadowRootHostCount: number }> {
  return page.evaluate(() => {
    const KW = /엑셀|excel|다운로드|download|내려받기|내보내기|export|추출|csv|xlsx/i;
    const nodes = Array.from(
      document.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']"),
    );
    let total = 0;
    let visible = 0;
    let enabled = 0;
    for (const el of nodes) {
      const text = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${(el as HTMLInputElement).value ?? ""}`;
      if (!KW.test(text)) continue;
      total += 1;
      const he = el as HTMLElement;
      if (he.offsetParent !== null || he.getClientRects().length > 0) visible += 1;
      const ariaDisabled = el.getAttribute("aria-disabled") === "true";
      if (!(el as HTMLButtonElement).disabled && !ariaDisabled) enabled += 1;
    }
    let shadowRootHostCount = 0;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if ((el as Element & { shadowRoot?: unknown }).shadowRoot) shadowRootHostCount += 1;
    }
    return { total, visible, enabled, shadowRootHostCount };
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

    confirmHost.announce(CONFIRM_ASK);
    const confirmation = await confirmHost.confirm(CONFIRM_ASK);
    if (confirmation.signal !== "ready") {
      // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
      console.error("No confirmation press — aborting without reading the page.");
      log("classify.aborted", { reason: confirmation.signal });
      return;
    }

    // 3) Read the page AS THE HUMAN LEFT IT (no re-navigation — a re-nav can reset the SPA).
    const hydrationWaitResult = await settleSpa(page);
    const { readyState, appRootChildCount } = await readDomScalars(page);
    const html = await page.content();

    // Session verdict gate (the five-state judgment), from the top document.
    const sessionSignals = extractProbeSignals({
      url: page.url(),
      html,
      readyState,
      appRootChildCount: appRootChildCount >= 0 ? appRootChildCount : undefined,
      hydrationWaitResult,
    });

    // No-click LAYOUT plan from the rendered HTML alone — never acts on the page.
    const plan = planExportAction(html);

    // Reused sanitized export-probe context (keyword presence, frame categories, and
    // the live visible/enabled candidate buckets from the read-only scan above).
    const live = await scanExportCandidates(page);
    const exportSignals = extractExportProbeSignals({
      url: page.url(),
      html,
      frameUrls: page.frames().map((f) => f.url()),
      shadowRootHostCount: live.shadowRootHostCount,
      exportCandidateTotal: live.total,
      exportCandidateVisible: live.visible,
      exportCandidateEnabled: live.enabled,
    });

    const summary = {
      sessionVerdict: sessionSignals.sessionVerdict,
      plan,
      exportSignals,
    };

    // Sanitized JSON is the only stdout payload; the log echoes coarse scalars only.
    console.log(JSON.stringify(summary, null, 2));
    log("export.classify.no-click", {
      sessionVerdict: summary.sessionVerdict,
      layout: plan.layout,
      hasActionableExportCandidate: plan.hasActionableExportCandidate,
      asyncMarkerPresent: plan.asyncMarkerPresent,
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