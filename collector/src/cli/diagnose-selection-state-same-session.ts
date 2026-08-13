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
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { collectSanitizedStorage } from "../naver/storage-collect";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import type { OperatorConfirmAsk } from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";

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
  title: "NAVER 저장소 메타데이터 진단",
  headline: "리뷰 관리 화면에 도착한 뒤 확인해 주세요.",
  lines: [
    "A browser window is open on NAVER. In that SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Complete the Commerce account / store selection if prompted.",
    "  3) Navigate to the SmartStore Center review-management / export page and",
    "     leave the browser OPEN.",
    "",
    "Then press [현재 화면 확인] in the SellerOps confirmation tab — nothing else advances this run. It will",
    "then read ONLY sanitized storage METADATA (origin categories, key-name hashes,",
    "value-length buckets, cookie flags). It never acts on the page, reads no stored",
    "value, captures nothing, records no status, and sends nothing to SellerOps.",
  ],
};

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

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
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
      log("diagnose.aborted", { reason: confirmation.signal });
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
    await ctx.close();
  }
}

void main();
