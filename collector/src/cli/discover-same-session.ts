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
 * discovery (see src/cli/same-session.ts). Always classify-only AND strictly
 * NO-CLICK: the export layout is decided from the rendered structure via the pure
 * `planExportAction` — the control is never clicked, no download is ever awaited,
 * nothing is captured. No SellerOps login/channel/upload, no saveAs, no backend;
 * LAST_SUCCESS is impossible.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag.
 */
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { planExportAction } from "../naver/export-classify";
import { extractExportProbeSignals } from "../naver/export-probe";
import { checkLiveSessionVerdict } from "../naver/session-check";
import { extractProbeSignals, type HydrationWaitResult } from "../naver/session-probe";
import { launchNaverContext, type PwPage } from "../profile";
import { writeStatus } from "../status";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import {
  buildExportProbeMeta,
  buildSessionProbeMeta,
  classifyOnlyStatus,
  classifyOnlyStatusFromPlan,
  emitExportProbe,
  emitSessionProbe,
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

/**
 * Live I/O: read a sanitized structural snapshot at a labeled phase and log it
 * (metadata-only — booleans/buckets/categories; never HTML, text, URL, or PII).
 * Diagnostic-only; called solely when --emit-session-probe is passed.
 */
async function logSessionProbe(
  realPage: Page,
  phase: string,
  hydrationWaitResult?: HydrationWaitResult,
): Promise<void> {
  const dom = await realPage.evaluate(() => {
    const root = document.querySelector("#app, #root, #__next, [data-reactroot]");
    return {
      readyState: document.readyState,
      appRootChildCount: root ? root.childElementCount : -1,
    };
  });
  const signals = extractProbeSignals({
    url: realPage.url(),
    html: await realPage.content(),
    readyState: dom.readyState,
    appRootChildCount: dom.appRootChildCount >= 0 ? dom.appRootChildCount : undefined,
    hydrationWaitResult,
  });
  log("session.probe", buildSessionProbeMeta(phase, signals));
}

/**
 * Live I/O: read a sanitized structural snapshot of the EXPORT area at a labeled
 * phase and log it (metadata-only — booleans/buckets/categories; never HTML,
 * labels, selectors, URL, or PII). Gathers a few live-only scalars the serialized
 * HTML can't give us — frame URL categories, shadow-root host count, and how many
 * keyword-matched export candidates are present/visible/enabled — then sanitizes
 * them through `extractExportProbeSignals`. Diagnostic-only; called solely when
 * --emit-export-probe is passed.
 */
async function logExportProbe(realPage: Page, phase: string): Promise<void> {
  // Generic, selector-free observation: interactive elements whose accessible
  // text reads like an export/download control. We count them (total / visible /
  // enabled) — we never return the text. This is observation, not selector
  // promotion: review-export.ts is left untouched.
  const live = await realPage.evaluate(() => {
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
  const signals = extractExportProbeSignals({
    url: realPage.url(),
    html: await realPage.content(),
    frameUrls: realPage.frames().map((f) => f.url()),
    shadowRootHostCount: live.shadowRootHostCount,
    exportCandidateTotal: live.total,
    exportCandidateVisible: live.visible,
    exportCandidateEnabled: live.enabled,
  });
  log("export.probe", buildExportProbeMeta(phase, signals));
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
  const wantProbe = emitSessionProbe(args);
  const wantExportProbe = emitExportProbe(args);
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

    // Diagnostic: snapshot the page AS THE HUMAN LEFT IT, before we re-navigate.
    // If this shows a logged-in shell but the post-renav snapshot does not, the
    // re-navigation is resetting the SPA (not a marker problem).
    if (wantProbe) await logSessionProbe(realPage, "after-confirm-before-renav");

    // 3) Re-navigate in the SAME context (session now established by the human),
    //    then best-effort wait for the SPA to settle before reading the session.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
    const hydrationWaitResult: HydrationWaitResult = await realPage
      .waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS })
      .then(() => "hydrated" as const)
      .catch(() => "timeout" as const);

    // Diagnostic: snapshot what the re-navigation + settle produced, before the
    // session check. If logged-in markers are absent here even when present in
    // the pre-renav snapshot, the issue is re-navigation/hydration, not markers.
    if (wantProbe) await logSessionProbe(realPage, "after-renav-before-check", hydrationWaitResult);

    // 4) Session check — the five-state verdict is the authority; never proceed to
    //    export on anything but LOGGED_IN. Each other verdict halts with an honest state.
    const verdict = await checkLiveSessionVerdict(page);
    if (verdict !== "LOGGED_IN") {
      // Diagnostic: confirm what the probe saw when it decided not-logged-in.
      if (wantProbe) await logSessionProbe(realPage, "after-check-logged-out", hydrationWaitResult);
      const { state, detail } = classifyOnlyStatus(verdict);
      writeStatus(cfg.statusFile, { state, detail, updatedAt: now() });
      log("run.halted", { state });
      return;
    }

    // Diagnostic: snapshot the export area on the confirmed logged-in page BEFORE
    // classification, so we can see whether export controls / keywords / frames are
    // present at all on the route the classifier is about to read.
    if (wantExportProbe) await logExportProbe(realPage, "logged-in-before-classify");

    // 5) NO-CLICK export-layout classification — decide sync/async/unrecognized from
    //    the rendered structure ALONE via the pure `planExportAction`. Unlike the old
    //    `runExport({ classifyOnly })` path, this NEVER clicks the control, never waits
    //    for a download, captures nothing, and uploads nothing. A recognized sync layout
    //    reads EXPORT_SYNC_DETECTED (discovery) — never COLLECTING/LAST_SUCCESS.
    const html = await realPage.content();
    const plan = planExportAction(html);

    // Diagnostic: when the classifier did not recognize the layout, snapshot the
    // export area again so the verdict can be explained — missing selector (export
    // keywords/controls present here) vs. hidden/gated UI (present but disabled/zero
    // visible) vs. iframe/sub-route (keywords absent here, a child frame present).
    if (wantExportProbe && plan.layout === "LAYOUT_UNRECOGNIZED") {
      await logExportProbe(realPage, "after-classify-layout-unrecognized");
    }

    const { state, detail } = classifyOnlyStatusFromPlan(verdict, plan);
    writeStatus(cfg.statusFile, { state, detail, updatedAt: now() });
    log("run.done", {
      state,
      layout: plan.layout,
      hasActionableExportCandidate: plan.hasActionableExportCandidate,
      asyncMarkerPresent: plan.asyncMarkerPresent,
      classifyOnly: true,
      noClick: true,
    });
  } finally {
    await ctx.close();
  }
}

void main();
