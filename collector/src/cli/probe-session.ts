/**
 * Live, DEBUG-SAFE session/SPA probe — one human-attended diagnostic run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run probe-session -- --i-understand-this-opens-live-naver
 *
 * Purpose: classify-only discovery keeps returning SESSION_EXPIRED on a fully
 * logged-in SmartStore Center. This probe navigates to NAVER_REVIEW_URL in the
 * SAME launcher/config/profile path as discovery, waits for the SPA to settle,
 * and prints ONLY a small set of sanitized structural signals
 * (`extractProbeSignals`) so we can correct the session markers + hydration wait.
 *
 * It NEVER saves screenshots / raw HTML / page text, NEVER uploads, NEVER starts
 * the backend, NEVER mutates the DB. It only reads the page and emits booleans /
 * bucketed counts / category enums. LIVE-ONLY — refuses to act without the
 * explicit per-run approval flag, exactly like discover-export.
 */
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { extractProbeSignals, type HydrationWaitResult } from "../naver/session-probe";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";

const HYDRATION_TIMEOUT_MS = 15_000;

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER session probe — requires explicit per-run operator approval.");
  console.error(" Reads the page for SANITIZED structural signals only. No HTML/text/");
  console.error(" screenshots are saved; nothing is uploaded; the backend is not used.");
  console.error(line);
}

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
    console.error("Set NAVER_REVIEW_URL to the review-management/export page URL first.");
    process.exit(2);
    return;
  }

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
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
  } finally {
    await ctx.close();
  }
}

void main();
