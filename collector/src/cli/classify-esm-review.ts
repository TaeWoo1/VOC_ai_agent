/**
 * Live, STRICT NO-CLICK ESM+ REVIEW export classifier — one human-attended diagnostic run.
 *
 *   set -a && . ./.env && set +a   # load ESM_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run classify-esm-review -- --i-understand-this-opens-live-esm
 *
 * This is Gate 2 of the ESM+ REVIEW model-C discovery ladder
 * (`docs/esmplus-review-export-discovery.md`). It opens a persistent context, hands off
 * to the human (login / navigate), and on the sentinel signal runs the SHARED no-click
 * classification (`classifyOpenEsmReviewPage`) against the page the human left — then
 * prints the sanitized result and CLOSES the browser. The actual scan logic lives in
 * `esm/esm-review-live-scan.ts` so the keep-open TTL probe can reuse it without closing.
 *
 * The ESM session lives ONLY in the dedicated `cfg.esmProfileDir` (separate from the
 * NAVER profile). A human performs all login / 2FA / CAPTCHA; the collector never types
 * credentials and never bypasses auth. Every read is READ-ONLY; the only output is
 * sanitized booleans / bucketed counts / category enums — never a selector, raw URL,
 * raw HTML, or any account / store / product / review / customer datum.
 *
 * CONTINUATION: it does NOT read a terminal keypress; it polls for the ESM sentinel file
 * whose exact absolute path it prints. Run only ONE probe/classifier at a time.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run ESM approval flag.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { esmApprovalRequiredMessage, hasEsmLiveApproval } from "../esm/esm-live-approval";
import { classifyOpenEsmReviewPage } from "../esm/esm-review-live-scan";
import { esmSentinelPathFor } from "../esm/esm-sentinel";
import { log } from "../log";
import { launchPersistentBrowser } from "../profile";

// The human may need to clear 2FA/CAPTCHA and any account/store flow; give them plenty
// of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

/** Prompt shown after the browser opens. The exact sentinel path is printed below it. */
const CONFIRM_PROMPT = [
  "",
  "A browser window is open on ESM+ (Gmarket / Auction). In that SAME window:",
  "  1) Complete the ESM+ login (and any 2FA/CAPTCHA) yourself.",
  "  2) Navigate to the review-management / feedback page and, if you can, make the",
  "     export controls visibly loaded.",
  "  3) Leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  'just say "ready" and Claude creates it). The collector is polling for it and will',
  "then read ONLY sanitized structural signals and classify the export surface. It",
  "never clicks a control, never waits for a file, captures nothing, writes no status",
  "record, starts no backend, and sends nothing to SellerOps. (Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE ESM+ no-click review export classifier — explicit per-run approval required.");
  console.error(" Read-only: a human logs in; the collector reads SANITIZED structural signals");
  console.error(" and classifies the export surface. No click, no file, no status write.");
  console.error(line);
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
 * timeout. Bounded by a fixed iteration count. The caller clears any stale sentinel
 * BEFORE calling this, so a hit only ever reflects a post-startup creation.
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
  if (!hasEsmLiveApproval(args)) {
    console.error(esmApprovalRequiredMessage());
    process.exit(3);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.esmReviewUrl) {
    console.error("Set ESM_REVIEW_URL to the ESM+ review-management/export page URL first.");
    process.exit(2);
    return;
  }

  // Single source of truth for the continuation file; clear any stale sentinel BEFORE
  // waiting so a leftover from a crashed run can never auto-proceed.
  const sentinelPath = esmSentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx = await launchPersistentBrowser(cfg.esmProfileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    // 1) Open the review route — this typically redirects to login / account select.
    await page.goto(cfg.esmReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Hand off to the human IN THE SAME CONTEXT; wait for the sentinel (not stdin).
    console.error(CONFIRM_PROMPT);
    console.error("");
    console.error(`  Sentinel file (create this when ready):`);
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
      console.error("No sentinel within the timeout; aborting without reading the page.");
      log("esm.classify.aborted", { reason: "sentinel-timeout" });
      return;
    }

    // 3) Read the page AS THE HUMAN LEFT IT via the SHARED no-click classification.
    const summary = await classifyOpenEsmReviewPage(page, cfg.esmFrameOriginAllowlist);
    const { signals, frameAware } = summary;

    // Sanitized JSON is the only stdout payload; the log echoes coarse scalars only.
    console.log(JSON.stringify(summary, null, 2));
    log("esm.review.classify.no-click", {
      domSettle: summary.domSettle,
      allowlistConfigured: summary.allowlistConfigured,
      sessionVerdict: signals.sessionVerdict,
      exportLayoutHint: signals.exportLayoutHint,
      topDocActionable: signals.hasActionableExportCandidate,
      aggregateActionable: frameAware.hasActionableExportCandidate,
      actionableScope: frameAware.actionableScope,
      skippedFrameCount: frameAware.skippedFrameCount,
      allowlistedFrameCount: frameAware.allowlistedFrameCount,
      asyncMarkerPresent: signals.asyncMarkerPresent,
      manageFeedbackRouteLike: signals.manageFeedbackRouteLike,
    });
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
