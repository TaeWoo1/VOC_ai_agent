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
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { collectSelectionSurface } from "../../src/naver/account-store-collect";
import { launchNaverContext } from "../../src/profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "../../src/cli/live-run-approval";
import type { OperatorConfirmAsk } from "../../src/cli/operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { pathToFileURL } from "node:url";

const HYDRATION_TIMEOUT_MS = 15_000;
// The human may need to clear 2FA/CAPTCHA and reach the account/store screen; give them
// plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/**
 * What the operator is asked to do, and confirm.
 *
 * It used to end with "just say \"ready\" and Claude creates it", which is exactly the channel that failed on
 * 2026-08-13: the assistant created the sentinel on the strength of a chat line the operator never wrote. The
 * instruction now names the one thing that advances this run, and it is not something a model can produce.
 */
const CONFIRM_ASK: OperatorConfirmAsk = {
  title: "NAVER 계정·스토어 선택 화면 판독",
  headline: "선택 화면에서 멈춘 채로 확인해 주세요 — 스토어를 아직 고르지 마세요.",
  lines: [
    "A browser window is open on NAVER. In that SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Reach the Commerce account / store SELECTION (or reconnect) screen and",
    "     STOP there — do NOT select a store yet. Leave the browser OPEN.",
    "",
    "Then press [현재 화면 확인] in the SellerOps confirmation tab — nothing else advances this run. It will",
    "then READ ONLY sanitized signals and REPORT what it WOULD do (would-resolve / ambiguous",
    "/ no-match / login / auth-challenge / unsupported). It never clicks, never selects a",
    "store, captures nothing, records no status, and sends nothing to SellerOps.",
  ],
};

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

    if (noSentinel) {
      // Auto-read: no manual ready needed. Settle the SPA, then read once. No click,
      // no selection, no status write, no upload — identical sanitized output.
      console.error(
        "Auto-read mode (--no-sentinel): reading after SPA hydration; no manual 'ready' needed.",
      );
      console.error("If a true login / 2FA / account screen shows instead, the report says so — nothing is clicked.");
      await settleSpa(page);
    } else {
      confirmHost.announce(CONFIRM_ASK);
      const confirmation = await confirmHost.confirm(CONFIRM_ASK);
      if (confirmation.signal !== "ready") {
        // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
        console.error("No confirmation press — aborting without reading the page.");
        log("classify.account-store.aborted", { reason: confirmation.signal });
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