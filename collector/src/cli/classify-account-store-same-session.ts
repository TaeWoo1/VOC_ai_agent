/**
 * Live, STRICT NO-CLICK account/store CLASSIFIER — one human-attended report-only run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + STORAGE_PROBE_SALT + channel
 *   npm run classify-account-store-same-session -- --i-understand-this-opens-live-naver
 *
 * Why this exists: the offline resolver core (`account-store-resolver`) is only a decision
 * engine — it cannot see the real Commerce account/store selection screen. This run lets a
 * human reach that screen and then REPORTS, WITHOUT clicking, what the resolver WOULD do:
 * `RESOLVED` (wouldClick) / `AMBIGUOUS` / `NO_MATCH` / `LOGIN_REQUIRED` /
 * `AUTH_CHALLENGE_REQUIRED` / `UNSUPPORTED_SURFACE`. It confirms the matcher picks the right
 * single candidate against the operator's expected identity BEFORE any click capability is
 * ever enabled (a later, separately-approved slice).
 *
 * It emits ONLY sanitized signals (surface enum, count buckets, salted candidate text
 * hashes, identity source categories, expected-match booleans, frame/popup booleans,
 * decision kind) via the pure `classifyAccountStoreSurface`. It NEVER clicks, selects an
 * account/store, navigates, captures, downloads, uploads, mutates a DB, writes a status
 * record, or prints a raw store/account name, id, URL, HTML, cookie, storage value, or token.
 *
 * SALT: candidate names are one-way hashed with `STORAGE_PROBE_SALT` (reused). It is read
 * from env, used only for hashing, and NEVER printed. Absent salt → FAILS CLOSED.
 *
 * CONTINUATION: like the sibling probes it does NOT read a terminal keypress; it polls for
 * the SAME sentinel file whose absolute path it prints — create it when ready. Run only ONE
 * probe/diagnostic at a time (shared sentinel path).
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { collectSelectionSurface } from "../naver/account-store-collect";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { sentinelPathFor } from "./probe-sentinel";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and reach the account/store screen; give them
// plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

/** Prompt shown after the browser opens. The exact sentinel path is printed below it. */
const CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Reach the Commerce account / store SELECTION (or reconnect) screen and",
  "     STOP there — do NOT select a store yet. Leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  "just say \"ready\" and Claude creates it). The collector is polling for it and will",
  "then READ ONLY sanitized signals and REPORT what it WOULD do (would-resolve / ambiguous",
  "/ no-match / login / auth-challenge / unsupported). It never clicks, never selects a",
  "store, captures nothing, records no status, and sends nothing to SellerOps.",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER no-click account/store CLASSIFIER — explicit per-run approval required.");
  console.error(" Report-only: a human reaches the selection screen; the collector reports the");
  console.error(" SANITIZED resolver decision. No click, no selection, no capture, no status write.");
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

/**
 * Poll for the sentinel file up to `timeoutMs`. Returns true once it appears, false on
 * timeout. Bounded by a fixed iteration count. The caller clears any stale sentinel BEFORE
 * calling this, so a hit only ever reflects a post-startup creation.
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
  // Fail closed without the shared salt — candidate name hashes must be salted so the
  // report is not a dictionary-attackable map of known names; never invent one per process.
  if (!cfg.storageProbeSalt) {
    console.error(
      "Refusing to run the account/store classifier without STORAGE_PROBE_SALT.\n" +
        "  - It one-way hashes candidate names; it is never printed or stored.",
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

  // Report-only AUTO-READ mode: when the target screen is directly reachable from
  // NAVER_REVIEW_URL, skip the manual `ready` sentinel — open, settle SPA, read once.
  // This ONLY changes the read trigger for this no-click diagnostic; it never relaxes the
  // live-approval gate and adds no click/capture/upload/status-write path.
  const noSentinel = args.includes("--no-sentinel") || args.includes("--auto-read-after-hydration");

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

    if (noSentinel) {
      // Auto-read: no manual ready needed. Settle the SPA, then read once. No click,
      // no selection, no status write, no upload — identical sanitized output.
      console.error(
        "Auto-read mode (--no-sentinel): reading after SPA hydration; no manual 'ready' needed.",
      );
      console.error("If a true login / 2FA / account screen shows instead, the report says so — nothing is clicked.");
      await settleSpa(page);
    } else {
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
        log("classify.account-store.aborted", { reason: "sentinel-timeout" });
        return;
      }
      // 3) Read the surface AS THE HUMAN LEFT IT (no re-navigation, no page action, no click).
      await settleSpa(page);
    }

    const { decision, signals, candidateShapes, hrefStructures, continuationCard, continueControls } =
      await collectSelectionSurface(page, ctx, expected, salt, expectedContinueCard);
    const wouldClick = decision.kind === "RESOLVED";

    // Sanitized JSON is the only stdout payload; the log echoes coarse scalars only.
    // All nested blocks are report-only structural diagnostics (booleans/buckets/
    // categories/hashes — never a raw value).
    console.log(
      JSON.stringify(
        {
          decisionKind: decision.kind,
          wouldClick,
          signals,
          candidateShapes,
          hrefStructures,
          continuationCard,
          continueControls,
        },
        null,
        2,
      ),
    );
    log("classify.account-store.no-click", {
      mode: noSentinel ? "auto-read" : "sentinel",
      surface: signals.surface,
      decisionKind: decision.kind,
      wouldClick,
      candidateCount: signals.candidateCount,
      matchCount: signals.matchCount,
      continuationDecision: continuationCard.decisionKind,
      continuationExpectedMatch: continuationCard.expectedMatch,
    });
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
