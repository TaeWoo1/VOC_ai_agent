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
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { continueAtCardOnce } from "../naver/account-store-continue";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { sentinelPathFor } from "./probe-sentinel";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and reach the reconnect-continue screen.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

/** Prompt shown after the browser opens. The exact sentinel path is printed below it. */
const CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Reach the single-account Commerce RECONNECT / CONTINUE screen and STOP there —",
  "     do NOT click continue yourself. Leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code, just",
  'say "ready" and Claude creates it). The collector is polling for it and will then read',
  "the sanitized state and, ONLY if it is READY_TO_CONTINUE (fingerprint matches + exactly",
  "one safe control), perform EXACTLY ONE continue click and report the post-click state.",
  "Anything ambiguous halts WITHOUT clicking. It never selects a store, never triggers an",
  "export, captures nothing, records no status, and sends nothing to SellerOps.",
].join("\n");

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

/** Poll for the sentinel file up to `timeoutMs`; true once it appears, false on timeout. */
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

  const sentinelPath = sentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce reconnect.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    if (sentinelMode) {
      console.error(CONFIRM_PROMPT);
      console.error("");
      console.error("  Sentinel file (create this when ready):");
      console.error(`    ${sentinelPath}`);
      console.error("");
      const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
      if (!ready) {
        console.error("No sentinel within the timeout; aborting without reading or clicking.");
        log("continue.account-store.aborted", { reason: "sentinel-timeout" });
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
    const result = await continueAtCardOnce(page, ctx, expected, salt, expectedContinueCard);

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
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
