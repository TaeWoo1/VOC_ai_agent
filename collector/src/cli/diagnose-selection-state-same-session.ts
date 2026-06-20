/**
 * Live, STRICT NO-CLICK browser-storage diagnostic — one human-attended run (State A).
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + STORAGE_PROBE_SALT + channel
 *   npm run diagnose-selection-state-same-session -- --i-understand-this-opens-live-naver
 *
 * Why this exists: the cold reconnect gap (Milestone C/D) showed the NAVER Commerce
 * account/store selection does not survive a cold programmatic context, and is NOT
 * URL-shaped (the route stays a generic SPA hash). This run captures STATE A — the
 * sanitized shape of the browser storage AFTER a human completes account/store
 * selection and reaches the review page — so it can later be diffed against the cold
 * STATE B (`discover --classify-only --diagnose-storage`) to locate WHERE the
 * selection state lives and which parts a cold context keeps.
 *
 * It emits ONLY sanitized metadata (origin category, storage type, bucketed key
 * counts, salted one-way key-name hashes + coarse categories, value-length buckets,
 * cookie flags) via the pure `extractStorageSignals`. It NEVER reads a stored value,
 * a raw key/cookie name, a raw URL, a host, a token, or any store/account id. It does
 * not act on the page, does not capture or persist a file, does not start a backend,
 * touches no DB, writes no status record, and sends nothing to SellerOps.
 *
 * SHARED SALT (A/B comparability): key names are hashed with `STORAGE_PROBE_SALT`.
 * The SAME salt must be set for this leg and the cold leg so their hashes line up for
 * the diff. The salt is read from env, used only for hashing, and NEVER printed. If it
 * is absent the run FAILS CLOSED.
 *
 * CONTINUATION: like the sibling probes it does NOT read a terminal keypress; it polls
 * for the SAME sentinel file whose absolute path it prints — create it when ready. Run
 * only ONE probe/diagnostic at a time (shared sentinel path).
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { collectSanitizedStorage } from "../naver/storage-collect";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { sentinelPathFor } from "./probe-sentinel";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give
// them plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

/** Prompt shown after the browser opens. The exact sentinel path is printed below it. */
const CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Complete the Commerce account / store selection if prompted.",
  "  3) Navigate to the SmartStore Center review-management / export page and",
  "     leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  "just say \"ready\" and Claude creates it). The collector is polling for it and will",
  "then read ONLY sanitized storage METADATA (origin categories, key-name hashes,",
  "value-length buckets, cookie flags). It never acts on the page, reads no stored",
  "value, captures nothing, records no status, and sends nothing to SellerOps.",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER no-click STORAGE diagnostic — explicit per-run approval required.");
  console.error(" Read-only: a human logs in + selects the store; the collector reads SANITIZED");
  console.error(" storage metadata only. No page action, no stored value, no status record.");
  console.error(line);
}

/** Best-effort SPA settle before reading (the review route is an SPA). */
async function settleSpa(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* a busy SPA may never reach networkidle; the storage read does not depend on it */
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

/**
 * Poll for the sentinel file up to `timeoutMs`. Returns true once it appears, false
 * on timeout. Bounded by a fixed iteration count. The caller clears any stale sentinel
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
  // Fail closed without the shared salt — the A/B diff is meaningless if the two legs
  // hash with different salts, and we will not silently invent one per process.
  if (!cfg.storageProbeSalt) {
    console.error(
      "Refusing to run the storage diagnostic without STORAGE_PROBE_SALT.\n" +
        "  - Set the SAME STORAGE_PROBE_SALT for this leg and the cold leg so the\n" +
        "    hashed key names are comparable for the A/B diff.\n" +
        "  - It is used only for one-way hashing and is never printed or stored.",
    );
    process.exit(2);
    return;
  }
  const salt = cfg.storageProbeSalt;

  // Single source of truth for the continuation file; clear any stale sentinel BEFORE
  // waiting so a leftover from a crashed run can never auto-proceed.
  const sentinelPath = sentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce select.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Hand off to the human IN THE SAME CONTEXT; wait for the sentinel (not stdin).
    console.error(CONFIRM_PROMPT);
    console.error("");
    console.error("  Sentinel file (create this when ready):");
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
      console.error("No sentinel within the timeout; aborting without reading the page.");
      log("diagnose.aborted", { reason: "sentinel-timeout" });
      return;
    }

    // 3) Read the storage AS THE HUMAN LEFT IT (no re-navigation, no page action).
    await settleSpa(page);
    const signals = await collectSanitizedStorage(page, ctx, { contextLabel: "A_same_session", salt });

    // Sanitized JSON is the only stdout payload; the log echoes coarse scalars only.
    console.log(JSON.stringify(signals, null, 2));
    log("diagnose.storage.no-click", {
      contextLabel: signals.contextLabel,
      groupCount: signals.groups.length,
    });
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
