/**
 * Live, READ-ONLY frame-aware EXPORT-AREA probe — one human-attended diagnostic run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run probe-export-same-session -- --i-understand-this-opens-live-naver
 *
 * Why this exists: `probe-same-session` reads only the TOP document, so on the review route a
 * LOGGED_IN page still reports `exportCandidateCount: "none"` — and that single reading cannot
 * distinguish a nested iframe from a shadow DOM, a sub-route, a gated/hidden control, or a marker
 * mismatch. This probe keeps the SAME one-context flow but reads the top document PLUS every child
 * frame, so the next live run can OBSERVE which frame (if any) actually hosts export controls
 * instead of guessing.
 *
 * It is a pure DIAGNOSTIC and is structurally separate from the classify-only discovery flow: it
 * never imports `review-export`, never classifies/triggers/clicks/captures an export, saves no
 * file, waits for no download, writes no status record, starts no backend, touches no DB, and
 * sends nothing to SellerOps. Every per-frame read is READ-ONLY (text/attribute/visibility scan
 * only — never a click, focus, submit, or dispatched event) and the only output is sanitized
 * booleans / bucketed counts / category enums.
 *
 * CONTINUATION: like `probe-same-session`, it does NOT read a terminal keypress (the Bash tool's
 * stdin does not reliably deliver Enter). It polls for the SAME sentinel file whose exact absolute
 * path it prints; the operator (or Claude on their behalf) creates that file when ready. Run only
 * ONE probe at a time — both probes share the sentinel path. See `probe-sentinel.ts`.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag, exactly like the other
 * live CLIs.
 */
import type { Frame, Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import {
  extractExportProbeSignals,
  summarizeFrameExportProbes,
  type FrameExportProbe,
} from "../naver/export-probe";
import { urlCategory } from "../naver/session-check";
import { extractProbeSignals, type HydrationWaitResult } from "../naver/session-probe";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import type { OperatorConfirmAsk } from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give them
// plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/**
 * What the operator is asked to do, and confirm.
 *
 * It used to end with "just say \"ready\" and Claude creates it", which is exactly the channel that failed on
 * 2026-08-13: the assistant created the sentinel on the strength of a chat line the operator never wrote. The
 * instruction now names the one thing that advances this run, and it is not something a model can produce.
 */
const PROBE_ASK: OperatorConfirmAsk = {
  title: "NAVER 내보내기 구조 판독",
  headline: "내보내기 화면에 직접 도착한 뒤 확인해 주세요.",
  lines: [
    "A browser window is open on NAVER. In that SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Navigate to the SmartStore Center review-management / export page and, if you",
    "     can, make the export controls visibly loaded.",
    "  3) Leave the browser OPEN.",
    "",
    "Then press [현재 화면 확인] in the SellerOps confirmation tab — nothing else advances this run. It will",
    "then read ONLY sanitized structural signals — top document plus every child frame —",
    "in this same window. It never classifies, triggers, clicks, or captures an export,",
    "saves no file, writes no status record, starts no backend, and sends nothing to",
    "SellerOps. (Ctrl-C to abort.)",
  ],
};

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER frame-aware export probe — explicit per-run approval required.");
  console.error(" Read-only: a human logs in; the collector reads SANITIZED structural signals");
  console.error(" from every frame. No export, no click, no status write. Ctrl-C to abort.");
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
 * READ-ONLY export-candidate scan, runnable in any frame's context. Counts interactive
 * elements whose accessible text reads like an export/download control (total / visible /
 * enabled) and how many elements host an OPEN shadow root. It only READS text/attributes/
 * geometry — it never clicks, focuses, submits, or dispatches an event, and it never returns
 * the matched text. Duplicated locally (not imported from the discovery CLI) to keep that CLI
 * untouched; the one change vs. its version is that this runs per-frame.
 */
async function scanExportCandidates(
  frame: Frame,
): Promise<{ total: number; visible: number; enabled: number; shadowRootHostCount: number }> {
  return frame.evaluate(() => {
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

/**
 * Read one child frame's sanitized export signals. Degrades gracefully: a detached /
 * navigating / about:blank frame is reported as "blocked" or "empty" with null signals,
 * never aborting the run or leaking anything.
 */
async function readChildFrame(frame: Frame): Promise<FrameExportProbe> {
  const frameUrlCategory = urlCategory(frame.url());
  try {
    const html = await frame.content();
    if (!html || html.trim().length === 0) {
      return { frameUrlCategory, readResult: "empty", signals: null };
    }
    const live = await scanExportCandidates(frame);
    const signals = extractExportProbeSignals({
      url: frame.url(),
      html,
      shadowRootHostCount: live.shadowRootHostCount,
      exportCandidateTotal: live.total,
      exportCandidateVisible: live.visible,
      exportCandidateEnabled: live.enabled,
    });
    return { frameUrlCategory, readResult: "read", signals };
  } catch {
    return { frameUrlCategory, readResult: "blocked", signals: null };
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

    // 3) Read the page AS THE HUMAN LEFT IT (no re-navigation — a re-nav can reset the SPA).
    const hydrationWaitResult = await settleSpa(page);
    const mainFrame = page.mainFrame();
    const childFrames = page.frames().filter((f) => f !== mainFrame);

    // Top document: session verdict gate + export signals (incl. the categories of all frames).
    const { readyState, appRootChildCount } = await readDomScalars(page);
    const topHtml = await page.content();
    const sessionSignals = extractProbeSignals({
      url: page.url(),
      html: topHtml,
      readyState,
      appRootChildCount: appRootChildCount >= 0 ? appRootChildCount : undefined,
      hydrationWaitResult,
    });
    const topLive = await scanExportCandidates(mainFrame);
    const topDocument = extractExportProbeSignals({
      url: page.url(),
      html: topHtml,
      frameUrls: page.frames().map((f) => f.url()),
      shadowRootHostCount: topLive.shadowRootHostCount,
      exportCandidateTotal: topLive.total,
      exportCandidateVisible: topLive.visible,
      exportCandidateEnabled: topLive.enabled,
    });

    // Child frames: one sanitized read each, degrading per-frame on any error.
    const frames: FrameExportProbe[] = [];
    for (const frame of childFrames) frames.push(await readChildFrame(frame));

    const summary = summarizeFrameExportProbes({
      sessionVerdict: sessionSignals.sessionVerdict,
      topDocument,
      frames,
    });

    // Sanitized JSON is the only stdout payload; the log echoes coarse scalars only.
    console.log(JSON.stringify(summary, null, 2));
    log("export.probe.frame-aware", {
      sessionVerdict: summary.sessionVerdict,
      frameCount: summary.frameCount,
      anyFrameExportCandidates: summary.anyFrameExportCandidates,
      childFrameCount: frames.length,
    });
  } finally {
    await ctx.close();
  }
}

void main();
