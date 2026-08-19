/**
 * Live, GATED, human-attended **NAVER GUIDED REVIEW REPLY SESSION v1** — the first end-to-end operator
 * workflow, carried from an approved SellerOps reply task to the live NAVER composer and stopped there.
 *
 *   set -a && . ./.env && set +a
 *   npx tsx instruments/live-runs/run-guided-reply-session-live-naver.ts -- --i-understand-this-posts-a-live-naver-reply
 *
 * The nine steps, in order:
 *   1. an approved NAVER review task supplies the request bundle {accountId, actionRef};
 *   2. the Action Window opens the seller's own browser profile on the review list;
 *   3. **the open seller/store session is verified against the connection registry — read-only, and
 *      MANDATORY. A mismatch or an unavailable identity stops the run before the review is ever looked up;**
 *   4. the operator is guided to render the review-number column;
 *   5. the target resolves by exact channel review id — global cardinality 1, outline re-verified in-page;
 *   6. the operator visually confirms the outlined row;
 *   7. the operator performs their OWN entry into the inline composer; the runtime only observes;
 *   8. the composer is highlighted and the approved draft is shown in a read-only SellerOps overlay;
 *   9. the run stops. The only terminal is SUBMISSION_ABORTED.
 *
 * WHAT THE RUNTIME NEVER DOES: click, navigate, type, paste, open the composer, or submit. Every NAVER action
 * is the operator's. The runtime inspects, guides, and highlights. There is exactly ONE `goto`, before the
 * operator has done anything; from their first action onward the runtime never navigates.
 *
 * WHAT IT DOES WRITE (named honestly, not hidden): this run mints a submission run and records the operator's
 * SUBMISSION_ABORTED outcome on the SellerOps backend, exactly as the proven composer-abort rehearsal does —
 * that IS the clean abort terminal. Those are SellerOps-side writes about the operator's own report. Nothing
 * is written to NAVER, and the reply is never posted. Verification stays permanently UNVERIFIED (D-032(b)).
 *
 * The account preflight never compares the internal sellerAccountId to page text. It fingerprints the most
 * stable store key the page exposes read-only and compares that with the registry's stored fingerprint,
 * returning only MATCH / MISMATCH / UNAVAILABLE / NEEDS_BINDING. No raw store token, account id, review id,
 * review body, draft, URL, or digest is ever logged or persisted.
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import { createLoopbackChannel } from "../../../contracts/action-window/v2/transport";
import {
  login,
  startReplySubmissionRun,
  submitReplyOutcome,
  fetchApprovedReplyDraft,
  fetchReviewIdentityFingerprint,
} from "../../src/upload";
import { loadRequestBundle } from "../../src/action-window/reply-submission/reply-target-bundle";
import type { RecencyBucket } from "../../src/action-window/reply-submission/reply-surface";
import { HandleReplyComposerDriver } from "../../src/action-window/reply-submission/handle-reply-composer-driver";
import type { AbortRowHandle } from "../../src/action-window/reply-submission/handle-reply-row-driver";
import {
  ARM_COMPOSER_CAPTURE,
  COMPOSER_CENSUS,
  COMPOSER_PICKED,
  COMPOSER_TEARDOWN,
  renderDraftOverlay,
} from "../../src/action-window/reply-submission/reply-composer-inpage";
import {
  assembleReplyRun,
  defaultReplyRunDirFor,
  makeReplyRunMarker,
  mintReplyRunId,
  recoverReplyRuns,
} from "../../src/action-window/reply-submission/reply-dispatch";
import type { ReplySubmitSession } from "../../src/action-window/reply-submission/reply-session";
import type { ReplyStage } from "../../src/action-window/reply-submission/reply-stages";
import { ReplyRunOperatorClient, replyLiveRunRefusal, watchForAbort } from "./run-reply-submission-live-naver";
import { waitForEntryTransition, type TransitionKind } from "./run-composer-abort-rehearsal-live-naver";
import {
  inPageOutlineRowAt,
  inPageReviewIdLadder,
  IN_PAGE_ID_OUTLINE_TEARDOWN,
  ID_MATCH_MARKER_ATTRIBUTE,
  type OutlineOutcome,
} from "../../src/action-window/reply-submission/review-id-probe-inpage";
import {
  locateRowByReviewId,
  reviewIdLocatorKeyFromFingerprint,
  type LocateOutcome,
} from "../../src/action-window/reply-submission/review-id-locator";
import { civilDateParts, ladderExposure, parseLadderResult } from "./run-review-id-reconciliation-live-naver";
import { currentKstDate } from "../../src/cli/kst-date";
import type { AccountFingerprintRawSignals } from "../../src/naver/account-fingerprint-adapter";
import { sessionSignalsFrom } from "../../src/action-window/reply-submission/session-signals";
import {
  defaultConnectionStorePath,
  loadConnectionRegistryFromFile,
  saveConnectionRegistryToFile,
  connectionStoreErrorCategory,
} from "../../src/connection/store";
import type { ConnectionRegistry } from "../../src/connection/registry";
import type { CollectorConnection } from "../../src/connection/types";
import { createPendingConnection } from "../../src/connection/connection";
import { sellerAccountFingerprint } from "../../src/connection/seller-account-fingerprint";
import { resolveLinkedConnection } from "../../src/action-window/reply-submission/session-account-verify";
import {
  loadSelectorSpecs,
  defaultSelectorStorePath,
  selectorStoreErrorCategory,
} from "../../src/action-window/reply-submission/chrome-selector-store";
import {
  selectorSpecsFingerprint,
  specsCollide,
  type ChromeSelectorSpecs,
} from "../../src/action-window/reply-submission/chrome-selector-spec";
import {
  inPageChromeIdentity,
  parseChromeIdentity,
} from "../../src/action-window/reply-submission/chrome-identity-inpage";
import {
  mayProceedAfterChromeIdentity,
  verifyChromeIdentity,
  type ChromeIdentityVerification,
} from "../../src/action-window/reply-submission/session-chrome-identity";
import { bindSessionChromeIdentity } from "../../src/action-window/reply-submission/session-chrome-binding";

const REPLY_CHANNEL_CODE = "naver";
const REQUEST_BUNDLE_REL_PATH = ".reply-target/request.json";
const RUN_RECORD_REL_DIR = ".guided-sessions";
const READY_TIMEOUT_MS = 15 * 60_000;
const CONFIRM_TIMEOUT_MS = 15 * 60_000;
const RESCAN_TIMEOUT_MS = 15 * 60_000;
const PICK_TIMEOUT_MS = 10 * 60_000;
const BARRIER_TIMEOUT_MS = 45 * 60_000;
const SUBMIT_WAIT_TIMEOUT_MS = 15 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;
const MAX_SCANS = 10;
/** The operator's own label for a connection created by the first-time binding step. */
const DEFAULT_CONNECTION_ALIAS_ENV = "SELLEROPS_CONNECTION_ALIAS";
const FALLBACK_CONNECTION_ALIAS = "naver-connection";

/** Where the guided session stopped. Every value except the last is a fail-closed stop. */
export type GuidedTerminal =
  | "OPERATOR_NOT_READY"
  | "ACCOUNT_PREFLIGHT_FAILED"
  | "ACCOUNT_BINDING_REFUSED"
  /** A barrier read CONTRADICTED the binding: this run saw a different seller session. */
  | "ACCOUNT_DRIFTED"
  /**
   * A barrier read could not be MADE — selectors stopped resolving, the page left the seller centre, the
   * spec source changed. Split out from `ACCOUNT_DRIFTED` because collapsing them asserts something the
   * run did not observe, and the likeliest cause is benign: the CLI's own first suggested entry is "click
   * the review body", which lands on a detail view whose chrome the selectors were never calibrated on.
   * Reporting that as a mid-session account switch sends the operator hunting a security incident that did
   * not happen — and `verifyChromeIdentity` goes out of its way to keep missing evidence and contrary
   * evidence apart, so erasing the distinction one layer up throws away exactly what it preserved.
   * Both still fail closed; only the name the operator reads first differs.
   */
  | "ACCOUNT_UNVERIFIABLE"
  | "REVIEW_NOT_RESOLVED"
  | "ROW_NOT_OUTLINED"
  | "ROW_REJECTED_BY_OPERATOR"
  | "COMPOSER_NOT_REACHED"
  | "COMPOSER_ABORT"
  | "RUN_FAILED";

/** Sanitized run record. Every field is a category, a count, or a boolean. */
export interface GuidedSessionRecord {
  runId: string;
  channel: string;
  terminal: GuidedTerminal;
  session: {
    verdict: ChromeIdentityVerification["verdict"];
    /** `preflight-not-run` when the run ended before the session was ever read. */
    reason: ChromeIdentityVerification["reason"] | "preflight-not-run";
    /** The shop's public name — stored by explicit decision; the user id never is. */
    observedShopName: string | null;
    boundShopDisplayName: string | null;
    shopNameDiffers: boolean;
    boundThisRun: boolean;
      /** Which calibrated selector index resolved per field, or -1. Never the selector text. */
    userIdSelectorIndex: number;
    shopNameSelectorIndex: number;
    /** Re-checked at the outline, at the composer step, and after the operator's entry. */
    reverifiedAtBarriers: number;
    driftReason: string | null;
  };
  review: {
    matched: boolean;
    matchMode: string | null;
    failureReason: string | null;
    matchCount: number;
    matchedSource: string | null;
    candidateRowCount: number;
    scanCount: number;
    rowsTruncated: boolean;
    tokensTruncated: boolean;
    outline: OutlineOutcome | null;
    operatorConfirmed: boolean;
  };
  composer: {
    entryTransition: TransitionKind | null;
    reachedBarrier: boolean;
    draftDisplayed: boolean;
    /** Pinned false: this runtime has no code path that enters text. */
    draftEntered: false;
    operatorOutcome: string | null;
    verification: string | null;
  };
  /**
   * Named honestly, and DERIVED — never asserted. It reads `verified-against-open-session` only when the
   * preflight actually reached `MATCH`; on every stop path it stays `not-verified-against-session`, which is
   * the same claim [D-036]'s run record was forced to make.
   */
  sellerAccountBinding: "verified-against-open-session" | "not-verified-against-session";
}

// ---------------------------------------------------------------------------
// small io helpers (mirrors of the proven CLIs — deliberately not shared, so a
// change to one live CLI cannot silently alter another's operator protocol)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    if (typeof t.unref === "function") t.unref();
  });
}
function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  // Clear it FIRST. Clearing only at startup left a window in which a sentinel created
  // before its own step was already there when the step arrived — so the wait returned
  // immediately and the gate passed without the operator having done the thing. That is
  // exactly how the re-render check nearly accepted selectors proven only once.
  removeSentinel(path);
  for (let i = 0; i < Math.max(1, Math.ceil(timeoutMs / SENTINEL_POLL_INTERVAL_MS)); i += 1) {
    if (existsSync(path)) return true;
    await sleep(SENTINEL_POLL_INTERVAL_MS);
  }
  return false;
}
async function waitForEither(a: string, b: string, timeoutMs: number): Promise<"a" | "b" | null> {
  // Same rule as waitForFile: a pre-existing answer is not an answer to a question that
  // had not been asked yet.
  removeSentinel(a);
  removeSentinel(b);
  for (let i = 0; i < Math.max(1, Math.ceil(timeoutMs / SENTINEL_POLL_INTERVAL_MS)); i += 1) {
    if (existsSync(a)) return "a";
    if (existsSync(b)) return "b";
    await sleep(SENTINEL_POLL_INTERVAL_MS);
  }
  return null;
}
function evalOn<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

export interface ChromeReadResult {
  verification: ChromeIdentityVerification;
  /** Raw values, in memory only, for the bind/rebind step. NEVER logged or persisted. */
  observedUserId: string | null;
  observedShopName: string | null;
  /** Session gates, from the pure producer whose signature cannot reach page text. */
  signals: AccountFingerprintRawSignals;
  /** Which selector index resolved per field, or -1. Diagnostics; never the selector text. */
  userIdSelectorIndex: number;
  shopNameSelectorIndex: number;
  /** Why candidates were rejected, per field. Fixed categories. */
  userIdRejections: string[];
  shopNameRejections: string[];
}

/**
 * One read of the composite seller-center identity through the CALIBRATED selectors.
 *
 * The selectors come from a separate operator-calibrated discovery run and are read
 * from disk; this CLI never invents one. Values are read through them, compared, and
 * dropped — the user id exists only inside this function and the bind step.
 */
async function readChromeIdentity(
  page: Page,
  specs: ChromeSelectorSpecs,
  specsFingerprint: string,
  connection: CollectorConnection,
): Promise<ChromeReadResult> {
  const url = page.url();
  const parsed = parseChromeIdentity(
    await evalOn<string>(
      page,
      inPageChromeIdentity(
        specs.userId.map((x) => x.selector),
        specs.shopName.map((x) => x.selector),
      ),
    ),
  );
  // Readable = BOTH calibrated fields produced a value. See session-signals.ts for why this replaced the
  // SPA-state-root count, which a live run proved is always zero on this surface.
  const observedUserId = parsed?.userId.value ?? null;
  const observedShopName = parsed?.shopName.value ?? null;
  const signals = sessionSignalsFrom(url, observedUserId !== null && observedShopName !== null, null);

  // ORIGIN GATE, applied to VERIFICATION and not only to binding. `bindSessionChromeIdentity` already
  // refuses `not-logged-in` off a seller-center origin; verification did not, so `signals` was computed at
  // every barrier and then thrown away. That matters at the entry barrier, where the operator's own
  // navigation may legitimately open a new tab: a page that merely REPRODUCES the bound pair through the
  // calibrated selectors would otherwise return MATCH, and a clone reproduces both by construction (the
  // shop name is public and the user id is on screen). Refusing here costs nothing — a genuine
  // seller-center page passes — and it makes the verdict mean "on NAVER, and the identity matches".
  if (!signals.loggedInSignal) {
    return {
      verification: Object.freeze({
        verdict: "UNAVAILABLE",
        reason: "off-seller-center",
        observedShopName,
        boundShopDisplayName: connection.boundShopDisplayName,
        currentSelectorSpecFingerprint: specsFingerprint,
        boundSelectorSpecFingerprint: connection.boundSelectorSpecFingerprint,
        selectorsCollide: specsCollide(specs),
        shopNameDiffers: false,
      }),
      observedUserId,
      observedShopName,
      signals,
      userIdSelectorIndex: parsed?.userId.selectorIndex ?? -1,
      shopNameSelectorIndex: parsed?.shopName.selectorIndex ?? -1,
      userIdRejections: parsed ? [...parsed.userId.rejections] : [],
      shopNameRejections: parsed ? [...parsed.shopName.rejections] : [],
    };
  }

  return {
    verification: verifyChromeIdentity({
      observedUserId,
      observedShopName,
      boundCompositeFingerprint: connection.boundSessionIdentityFingerprint,
      boundShopDisplayName: connection.boundShopDisplayName,
      currentSelectorSpecFingerprint: specsFingerprint,
      boundSelectorSpecFingerprint: connection.boundSelectorSpecFingerprint,
      selectorsCollide: specsCollide(specs),
    }),
    observedUserId,
    observedShopName,
    signals,
    userIdSelectorIndex: parsed?.userId.selectorIndex ?? -1,
    shopNameSelectorIndex: parsed?.shopName.selectorIndex ?? -1,
    userIdRejections: parsed ? [...parsed.userId.rejections] : [],
    shopNameRejections: parsed ? [...parsed.shopName.rejections] : [],
  };
}

/**
 * Which terminal a failed barrier read deserves. A MISMATCH is a contradiction (`ACCOUNT_DRIFTED`);
 * anything else is absent evidence (`ACCOUNT_UNVERIFIABLE`). Both stop the run.
 */
function barrierTerminal(v: ChromeIdentityVerification): GuidedTerminal {
  return v.verdict === "MISMATCH" ? "ACCOUNT_DRIFTED" : "ACCOUNT_UNVERIFIABLE";
}

/**
 * Operator-facing report. The shop name is shown (it is the shop's public name and the
 * operator needs it to answer); the USER ID is never printed — the operator can already
 * see it on their own screen, and printing it would put it in a terminal scrollback.
 */
function reportChrome(result: ChromeReadResult, label: string): void {
  const v = result.verification;
  console.error("");
  console.error(`SESSION ${label}: ${v.verdict} (${v.reason})`);
  console.error(`  shop on screen   ${v.observedShopName ?? "(unreadable)"}`);
  console.error(`  shop at bind     ${v.boundShopDisplayName ?? "(not bound)"}`);
  console.error(`  selector used    user=${result.userIdSelectorIndex} shop=${result.shopNameSelectorIndex}`);
  if (result.userIdRejections.length > 0) {
    console.error(`  ! user-id candidates rejected: ${result.userIdRejections.join(", ")}`);
  }
  if (result.shopNameRejections.length > 0) {
    console.error(`  ! shop-name candidates rejected: ${result.shopNameRejections.join(", ")}`);
  }
  if (v.shopNameDiffers) {
    console.error("  i the shop NAME differs from the one recorded at bind time. That is ALL this says: a");
    console.error("    rename and a different seller account look identical from here. Only you can tell.");
  }
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" GUIDED REPLY SESSION v1 — the runtime verifies the open store, resolves the target review by");
  console.error(" its channel review id, highlights the row and then the composer, and shows the approved draft");
  console.error(" READ-ONLY. It never clicks, navigates, types, pastes, opens the composer, or submits — you do.");
  console.error(" The only terminal is SUBMISSION_ABORTED. Stop before typing or pasting anything.");
  console.error(line);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  banner();
  const refusal = replyLiveRunRefusal(args, process.env);
  if (refusal) {
    console.error(refusal.reason);
    process.exit(refusal.exitCode);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management page URL first.");
    process.exit(2);
    return;
  }

  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const requestPath = resolve(collectorRoot, REQUEST_BUNDLE_REL_PATH);
  const request = loadRequestBundle(requestPath, { existsSync, statSync, readFileSync });
  if (!request) {
    console.error(`No request bundle at ${requestPath} — create it {accountId, actionRef} (0600) first.`);
    process.exit(2);
    return;
  }

  const runId = `gsn_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  // Defaults to the EARLIEST stop, so a run that dies before the preflight cannot be recorded as though the
  // preflight had run and failed. The terminal is only advanced by reaching a stage.
  let terminal: GuidedTerminal = "OPERATOR_NOT_READY";
  let chromeResult: ChromeReadResult | null = null;
  let boundThisRun = false;
  let reverifiedAtBarriers = 0;
  let driftReason: string | null = null;
  let locate: LocateOutcome | null = null;
  let candidateRowCount = 0;
  let scanCount = 0;
  let rowsTruncated = false;
  let tokensTruncated = false;
  let outline: OutlineOutcome | null = null;
  let operatorConfirmed = false;
  let entryTransition: TransitionKind | null = null;
  let reachedBarrier = false;
  let draftDisplayed = false;
  let operatorOutcome: string | null = null;
  let runVerification: string | null = null;

  const storePath = defaultConnectionStorePath(collectorRoot);
  let registry: ConnectionRegistry;
  try {
    registry = loadConnectionRegistryFromFile(storePath);
  } catch (e) {
    // A store we cannot read is not an empty store: binding into it could clobber real connections.
    console.error(`Connection registry unreadable (${connectionStoreErrorCategory(e)}); failing closed.`);
    process.exit(2);
    return;
  }

  // The calibrated selectors come from a SEPARATE operator-calibrated discovery run. This CLI never invents
  // one: without them there is nothing to read the identity through, and guessing is how three previous
  // identity designs failed.
  let specs: ChromeSelectorSpecs;
  try {
    const loaded = loadSelectorSpecs(defaultSelectorStorePath(collectorRoot));
    if (loaded === null) {
      console.error(
        "No calibrated chrome selectors. Run the selector-discovery CLI first:\n" +
          "  npx tsx instruments/live-runs/run-chrome-selector-discovery-live-naver.ts -- --i-understand-this-inspects-live-naver-read-only",
      );
      process.exit(2);
      return;
    }
    specs = loaded;
  } catch (e) {
    console.error(`Calibrated selectors unreadable (${selectorStoreErrorCategory(e)}); failing closed.`);
    process.exit(2);
    return;
  }
  const specsFingerprint = selectorSpecsFingerprint(specs);
  if (specsCollide(specs)) {
    console.error("The calibrated selectors read the SAME element for both fields; re-run discovery. Stopping.");
    process.exit(2);
    return;
  }

  // The backend hands over a one-way digest of the channel review id — the raw id never exists here.
  const token = await login(cfg.baseUrl, cfg.email, cfg.password);
  const identity = await fetchReviewIdentityFingerprint(cfg.baseUrl, token, request.accountId, request.actionRef);
  if (!identity.channelReviewIdFingerprint) {
    console.error("This review has no channel-side id fingerprint; the exact locator cannot run. Stopping.");
    process.exit(2);
    return;
  }
  const key = reviewIdLocatorKeyFromFingerprint(
    REPLY_CHANNEL_CODE,
    request.accountId,
    identity.channelReviewIdFingerprint,
  );
  if (!key) {
    console.error("The backend fingerprint is not well-formed; refusing to search on a malformed key.");
    process.exit(2);
    return;
  }
  const asOf = civilDateParts(currentKstDate());
  if (!asOf) {
    console.error("Could not derive today's KST date; refusing to scan against an unknown as-of date.");
    process.exit(2);
    return;
  }

  const persistDir = defaultReplyRunDirFor(collectorRoot);
  const { parked } = recoverReplyRuns(persistDir, makeReplyRunMarker());
  if (parked.length > 0) log("aw.reply.parked", { count: parked.length });

  const statusDir = dirname(cfg.statusFile);
  mkdirSync(statusDir, { recursive: true });
  const readySentinel = resolve(statusDir, "guided-ready.ready");
  const bindConfirmedSentinel = resolve(statusDir, "guided-bind-confirmed.ready");
  const rowConfirmedSentinel = resolve(statusDir, "guided-row-confirmed.ready");
  const rowMismatchSentinel = resolve(statusDir, "guided-row-mismatch.ready");
  const rescanSentinel = resolve(statusDir, "guided-rescan.ready");
  const stopSentinel = resolve(statusDir, "guided-stop.ready");
  const abortedSentinel = resolve(statusDir, "guided-aborted.ready");
  const allSentinels = [
    readySentinel,
    bindConfirmedSentinel,
    rowConfirmedSentinel,
    rowMismatchSentinel,
    rescanSentinel,
    stopSentinel,
    abortedSentinel,
  ];
  for (const s of allSentinels) removeSentinel(s);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  let activePage: Page = page;
  let session: ReplySubmitSession | undefined;

  // The record build lives in an OUTER `finally` on purpose. Every fail-closed path below returns early, and
  // a record built after a plain try/finally would be skipped by all of them — so an honest stop, the outcome
  // this milestone most needs evidence for, would leave no evidence at all.
  try {
  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // --- step 4: operator readiness -----------------------------------------------------------------
    console.error(
      [
        "",
        "In the open browser: log in if needed, reach the review list, and FILTER so the target review is visible.",
        "Scroll RIGHT until the 리뷰글번호 (review number) column is on screen — off-screen, its cells are not in",
        "the DOM at all and the exact locator cannot see them (this is D-036, learned the expensive way).",
        "Stay ON THE LIST — do NOT click into the review yet.",
        `When ready, create:  ${readySentinel}`,
        "",
      ].join("\n"),
    );
    if (!(await waitForFile(readySentinel, READY_TIMEOUT_MS))) {
      console.error("No readiness signal; ending without a run.");
      return;
    }
    removeSentinel(readySentinel);
    const openPages = ctx.pages();
    if (openPages.length === 0) {
      console.error("The browser page was closed — retry with the window open.");
      return;
    }
    activePage = openPages[openPages.length - 1] as Page;

    // --- step 3: the MANDATORY composite session preflight -------------------------------------------
    // Resolve WHICH connection this run concerns, by data. Zero means the account link was never bound;
    // more than one is a registry we cannot reason about and naming one would be a guess.
    const resolution = resolveLinkedConnection(registry.list(), request.accountId);
    if (!resolution.ok && resolution.reason !== "no-connection-for-account") {
      // A malformed account id or two connections claiming one account are both states we cannot reason
      // about. Only "never linked yet" is recoverable, and only through the confirmed binding below.
      terminal = "ACCOUNT_PREFLIGHT_FAILED";
      console.error(`Cannot resolve one connection for this seller account (${resolution.reason}). Stopping.`);
      return;
    }
    // A first run has no connection at all. The record is CREATED IN MEMORY here and persisted only inside
    // the confirmed binding step below — nothing is written before the operator has said yes.
    let connection = resolution.ok
      ? resolution.connection
      : createPendingConnection({
          connectionId: randomUUID(),
          platform: "NAVER_SMARTSTORE",
          userProvidedDisplayName:
            (process.env[DEFAULT_CONNECTION_ALIAS_ENV] ?? "").trim() || FALLBACK_CONNECTION_ALIAS,
          now: new Date().toISOString(),
          boundSellerAccountFingerprint: sellerAccountFingerprint(request.accountId),
        });
    const connectionIsNew = !resolution.ok;

    chromeResult = await readChromeIdentity(activePage, specs, specsFingerprint, connection);
    reportChrome(chromeResult, "PREFLIGHT");

    // POLICY (product owner, 2026-07-21): a MISMATCH against an existing binding ends the run. There is
    // deliberately NO inline rebind.
    //
    // The reason is that the runtime cannot distinguish a renamed shop from a login as a different seller —
    // the composite is one-way and no user id is stored, so both produce byte-identical evidence. An inline
    // "was it renamed?" affordance therefore asks the operator to certify something at the exact moment they
    // are trying to get on with a reply, and one wrong click writes a permanent binding with no unbind path.
    // Rebinding belongs in a deliberate connection-management flow, not in the middle of a reply session.
    const needsBind = chromeResult.verification.reason === "no-binding";

    if (needsBind) {
      console.error(
        [
          "",
          "This connection has no session identity bound yet.",
          "",
          "Check the ACCOUNT and SHOP shown in your browser right now. (The account id is deliberately not",
          "printed here — you can see it on screen, and echoing it would put it in this terminal's history.)",
          `  shop name on screen ${chromeResult.observedShopName ?? "(unreadable)"}`,
          "",
          `  confirm this account+shop IS the one for this task → ${bindConfirmedSentinel}`,
          `  stop                                              → ${stopSentinel}`,
          "",
        ].join("\n"),
      );
      const answer = await waitForEither(bindConfirmedSentinel, stopSentinel, CONFIRM_TIMEOUT_MS);
      removeSentinel(bindConfirmedSentinel);
      removeSentinel(stopSentinel);
      if (answer !== "a") {
        terminal = "ACCOUNT_BINDING_REFUSED";
        console.error("Not confirmed; nothing was bound and the run stops here.");
        return;
      }

      // Re-read the registry AND the page: the evidence above predates a wait of up to CONFIRM_TIMEOUT_MS,
      // and a binding is permanent with no unbind path.
      try {
        registry = loadConnectionRegistryFromFile(storePath);
      } catch (e) {
        terminal = "ACCOUNT_BINDING_REFUSED";
        console.error(`Connection registry became unreadable (${connectionStoreErrorCategory(e)}); nothing bound.`);
        return;
      }
      const reResolved = resolveLinkedConnection(registry.list(), request.accountId);
      if (reResolved.ok) {
        // Something linked this account while the operator was deciding. Use THAT record rather than the
        // one built in memory, so a concurrent write is never clobbered.
        connection = reResolved.connection;
      } else if (reResolved.reason !== "no-connection-for-account" || !connectionIsNew) {
        terminal = "ACCOUNT_BINDING_REFUSED";
        console.error(`The connection stopped resolving (${reResolved.reason}); nothing bound.`);
        return;
      }
      // The evidence the operator actually looked at, captured BEFORE the wait.
      const confirmedUserId = chromeResult.observedUserId;
      const confirmedShopName = chromeResult.observedShopName;
      chromeResult = await readChromeIdentity(activePage, specs, specsFingerprint, connection);

      // The re-read is a CHECK, not a replacement. Substituting the fresher pair would bind an identity the
      // operator never saw: they confirm "shop A is the one for this task", then switch stores (or a
      // background SPA re-auth drops them on their default shop) before creating the sentinel, and the
      // permanent binding silently lands on shop B. The registry got this treatment already, two lines up;
      // the page did not. A permanent write with no unbind path must bind exactly what was confirmed.
      if (
        chromeResult.observedUserId !== confirmedUserId ||
        chromeResult.observedShopName !== confirmedShopName
      ) {
        terminal = "ACCOUNT_BINDING_REFUSED";
        console.error("The account/shop on screen CHANGED between the prompt and your confirmation.");
        console.error("Nothing was bound. Return to the shop you meant and re-run.");
        return;
      }

      const bind = bindSessionChromeIdentity({
        connection,
        observedUserId: chromeResult.observedUserId,
        observedShopName: chromeResult.observedShopName,
        // Only ever first-time here. `bindSessionChromeIdentity` refuses `already-bound`, so even a race
        // that bound the connection during the prompt cannot be overwritten by this path.
        intent: "first-time",
        operatorConfirmed: true,
        signals: chromeResult.signals,
        selectorSpecFingerprint: specsFingerprint,
        now: new Date().toISOString(),
      });
      if (!bind.ok) {
        terminal = "ACCOUNT_BINDING_REFUSED";
        console.error(`Binding refused (${bind.reason}); nothing was persisted.`);
        return;
      }
      registry.upsert(bind.connection);
      try {
        saveConnectionRegistryToFile(storePath, registry);
      } catch {
        terminal = "ACCOUNT_BINDING_REFUSED";
        console.error("Could not persist the connection registry; nothing is bound. Stopping.");
        return;
      }
      connection = bind.connection;
      boundThisRun = true;
      console.error(`Bound to "${bind.shopDisplayName}".`);
      // Re-verify through the SAME path a later run takes. Binding and then trusting the bind would prove
      // nothing about whether verification works.
      chromeResult = await readChromeIdentity(activePage, specs, specsFingerprint, connection);
      reportChrome(chromeResult, "POST-BINDING");
    }

    if (chromeResult.verification.verdict === "MISMATCH") {
      terminal = "ACCOUNT_PREFLIGHT_FAILED";
      console.error("");
      console.error("The open session does not match this connection's binding. Stopping.");
      if (chromeResult.verification.shopNameDiffers) {
        console.error("The shop NAME differs from the one recorded at bind time. That could be a rename or a");
        console.error("different seller — this run cannot tell, and will not ask you to decide mid-reply.");
        console.error("Rebinding is a deliberate connection-management action, not a step in a reply session.");
      }
      return;
    }

    if (!mayProceedAfterChromeIdentity(chromeResult.verification)) {
      terminal = "ACCOUNT_PREFLIGHT_FAILED";
      console.error("");
      console.error("The open session is not proven to be the bound shop. Stopping BEFORE any review lookup.");
      return;
    }
    const boundConnection = connection;
    console.error("");
    console.error(`Session preflight PASSED for "${chromeResult.verification.observedShopName}".`);

    // --- step 5: resolve the target review by exact channel review id --------------------------------
    for (;;) {
      scanCount += 1;
      const ladder = parseLadderResult(await evalOn<unknown>(activePage, inPageReviewIdLadder(asOf)));
      candidateRowCount = ladder.rowCount;
      rowsTruncated = ladder.rowsTruncated;
      tokensTruncated = ladder.tokensTruncated;
      locate = locateRowByReviewId(
        key,
        { channel: REPLY_CHANNEL_CODE, sellerAccountId: request.accountId },
        ladder.candidates,
        { rating: identity.rating ?? null, recencyBucket: null, productRefFingerprint: null },
      );
      if (locate.matched || scanCount >= MAX_SCANS) break;

      const exposure = ladderExposure(ladder.candidates);
      console.error("");
      console.error(`NO IDENTITY MATCH (scan ${scanCount}) — ${locate.reason}.`);
      console.error(`  candidate rows ${candidateRowCount}, visible-text exposure ${exposure["visible-text"]}`);
      if (rowsTruncated || tokensTruncated) {
        console.error("  ! the scan was truncated — a miss here proves nothing about the surface.");
      } else if (candidateRowCount > 0 && exposure["visible-text"] < candidateRowCount) {
        console.error("  i fewer rows exposed a token than were scanned — the 리뷰글번호 column may still be off-screen.");
      }
      console.error(`  adjust the view then → ${rescanSentinel}   |   give up → ${stopSentinel}`);
      const again = await waitForEither(rescanSentinel, stopSentinel, RESCAN_TIMEOUT_MS);
      removeSentinel(rescanSentinel);
      removeSentinel(stopSentinel);
      if (again !== "a") break;
    }

    if (!locate.matched) {
      terminal = "REVIEW_NOT_RESOLVED";
      console.error(`The target review did not resolve to exactly one row (${locate.reason}). Stopping.`);
      return;
    }

    // A HIT ON A TRUNCATED SCAN IS NOT GLOBAL CARDINALITY 1.
    //
    // Truncation was carried into the record and reported on the MISS path ("a miss here proves nothing
    // about the surface") — correctly — but it never gated the HIT path. So a scan that stopped short
    // could find exactly one match among the rows it did read and the run would go on to claim
    // `matchCount: 1`, which E3 and this file's own header read as "exactly one row on the surface". The
    // unscanned remainder may hold another. The locator is handed a candidate list and answers about that
    // list; only the caller knows the list was partial, so only the caller can refuse.
    if (rowsTruncated || tokensTruncated) {
      terminal = "REVIEW_NOT_RESOLVED";
      console.error("");
      console.error("The row matched, but the scan was TRUNCATED — so this is one match among the rows that");
      console.error("were read, not proof that only one row on the surface carries this review id. Stopping");
      console.error("rather than recording a cardinality that was never established.");
      console.error("Narrow the filter so the whole result set fits in one scan, then re-run.");
      return;
    }

    // Account re-check #1 — immediately before mutating the page with an outline.
    const atOutline = await readChromeIdentity(activePage, specs, specsFingerprint, boundConnection);
    reverifiedAtBarriers += 1;
    // The barrier read REPLACES the preflight one in the record. Reporting the preflight's MATCH beside an
    // ACCOUNT_DRIFTED terminal would be the exact claim the scope forbids on a stop path.
    chromeResult = atOutline;
    if (!mayProceedAfterChromeIdentity(atOutline.verification)) {
      terminal = barrierTerminal(atOutline.verification);
      driftReason = atOutline.verification.reason;
      console.error(`Session re-check failed between preflight and outline (${terminal}: ${driftReason}). Stopping.`);
      return;
    }

    outline = await evalOn<OutlineOutcome>(
      activePage,
      inPageOutlineRowAt(locate.rowIndex, key.channelReviewIdFingerprint),
    );
    if (outline !== "outlined") {
      terminal = "ROW_NOT_OUTLINED";
      console.error(`The matched row could not be re-verified in the page (${outline}). Stopping.`);
      return;
    }

    // --- step 6: the operator confirms the row -------------------------------------------------------
    console.error(
      [
        "",
        "The target review row is OUTLINED (green). Confirm it is the review you approved a reply for.",
        `  correct → ${rowConfirmedSentinel}`,
        `  wrong   → ${rowMismatchSentinel}`,
        "",
      ].join("\n"),
    );
    const rowAnswer = await waitForEither(rowConfirmedSentinel, rowMismatchSentinel, CONFIRM_TIMEOUT_MS);
    removeSentinel(rowConfirmedSentinel);
    removeSentinel(rowMismatchSentinel);
    if (rowAnswer !== "a") {
      terminal = "ROW_REJECTED_BY_OPERATOR";
      console.error("The outlined row was not confirmed. Stopping without touching the composer.");
      return;
    }
    operatorConfirmed = true;

    const rowHandle = (await activePage.$(`[${ID_MATCH_MARKER_ATTRIBUTE}]`)) as unknown as AbortRowHandle | null;
    if (!rowHandle) {
      terminal = "ROW_NOT_OUTLINED";
      console.error("The outlined row detached before it could be retained; re-run in a fresh session.");
      return;
    }

    // Account re-check #2 — immediately before entering the composer half of the session.
    const atComposer = await readChromeIdentity(activePage, specs, specsFingerprint, boundConnection);
    reverifiedAtBarriers += 1;
    chromeResult = atComposer;
    if (!mayProceedAfterChromeIdentity(atComposer.verification)) {
      terminal = barrierTerminal(atComposer.verification);
      driftReason = atComposer.verification.reason;
      console.error(`Session re-check failed before the composer step (${terminal}: ${driftReason}). Stopping.`);
      return;
    }

    // --- steps 7-9: composer guidance, draft overlay, abort -------------------------------------------
    const run = await startReplySubmissionRun(cfg.baseUrl, token, request.accountId, request.actionRef, {
      requireTargetHint: true,
    });
    if (!run.targetHint) {
      terminal = "COMPOSER_NOT_REACHED";
      console.error("Backend returned no target hint for this review; cannot open the guided barrier.");
      return;
    }

    // Set when a barrier inside the driver callback has already failed closed. The callback cannot
    // `return` out of `main`, so without this the engine parks at WAIT_FOR_ROW_OPEN and `stageReached`
    // spins the full 45-minute barrier timeout — leaving the browser sitting on the wrong account with the
    // outline and banner installed, teardown unrun, and (before the abort watch moved) no way to end it
    // with a sentinel. A fail-closed detection that does not actually close is one operators learn to
    // Ctrl-C through.
    let barrierAbandoned = false;

    const acquireComposer = async (): Promise<AbortRowHandle | null> => {
      console.error(
        [
          "",
          "Now perform your OWN entry into the reply composer:",
          "  • click the review body/link, OR",
          "  • check the row's checkbox and click the toolbar reply action.",
          "(The runtime does NOT click or navigate — you do. It only observes the transition.)",
          "",
        ].join("\n"),
      );
      const listUrl = activePage.url();
      const baselinePages = ctx.pages().length;
      // FAIL CLOSED on an unreadable baseline. Defaulting to 0 is not a safe default here: the transition
      // watcher declares INLINE_COMPOSER as soon as the census EXCEEDS the baseline, and a review list
      // already contains textareas/[contenteditable]/[role=textbox]. So a baseline of 0 makes the very
      // first poll report a composer entry the operator never performed — after which barrier 3 re-reads
      // identity on the same unchanged page (and passes), the capture is armed, and whatever the operator
      // clicks next becomes "the composer", with the approved draft rendered beside a review that was
      // never opened. `waitForEntryTransition` is careful about exactly this internally; the caller was not.
      let baselineCensus: number;
      try {
        baselineCensus = await evalOn<number>(activePage, COMPOSER_CENSUS);
      } catch {
        console.error("Could not read the composer baseline; refusing to guess it. The barrier stays shut.");
        barrierAbandoned = true;
        return null;
      }
      const transition = await waitForEntryTransition(ctx, listUrl, baselinePages, baselineCensus, CONFIRM_TIMEOUT_MS);
      if (!transition) {
        console.error("No entry transition observed within the window; the composer barrier will not open.");
        barrierAbandoned = true;
        return null;
      }
      entryTransition = transition;
      const pages = ctx.pages();
      if (pages.length === 0) return null;
      activePage = pages[pages.length - 1] as Page;
      try {
        await activePage.waitForLoadState("domcontentloaded");
      } catch {
        /* best-effort settle */
      }
      // Barrier #3. The operator's entry replaced the active page, and a store switch during that entry
      // would otherwise be unchecked all the way to the draft overlay.
      const atEntry = await readChromeIdentity(activePage, specs, specsFingerprint, boundConnection);
      reverifiedAtBarriers += 1;
      chromeResult = atEntry;
      if (!mayProceedAfterChromeIdentity(atEntry.verification)) {
        terminal = barrierTerminal(atEntry.verification);
        driftReason = atEntry.verification.reason;
        barrierAbandoned = true;
        console.error(`Session re-check failed during composer entry (${terminal}: ${driftReason}). Stopping.`);
        return null;
      }
      console.error(`Entry observed (${transition}). Now CLICK the reply composer ONCE (intercepted — no input)…`);
      await evalOn<boolean>(activePage, ARM_COMPOSER_CAPTURE);
      for (let i = 0; i < Math.ceil(PICK_TIMEOUT_MS / SENTINEL_POLL_INTERVAL_MS); i += 1) {
        if (await evalOn<boolean>(activePage, COMPOSER_PICKED)) {
          return (await activePage.$("[data-aw-composer-anchor]")) as unknown as AbortRowHandle | null;
        }
        await sleep(SENTINEL_POLL_INTERVAL_MS);
      }
      console.error("No composer picked within the window; the composer barrier will not open.");
      // Disarm the capture handler. It self-removes only on a click, so leaving it armed would suppress
      // the operator's next click ANYWHERE on the page — the runtime silently cancelling an operator
      // action after the step it belonged to has ended.
      await evalOn<number>(activePage, COMPOSER_TEARDOWN).catch(() => undefined);
      barrierAbandoned = true;
      return null;
    };

    const waitSubmit = () =>
      new Promise<boolean>((r) => {
        const t = setTimeout(() => r(false), SUBMIT_WAIT_TIMEOUT_MS);
        if (typeof t.unref === "function") t.unref();
      });

    const replyRunId = mintReplyRunId();
    const channel = createLoopbackChannel();
    const assembly = assembleReplyRun(channel.server, {
      runId: replyRunId,
      channelCode: REPLY_CHANNEL_CODE,
      submissionRef: run.submissionRef,
      targetHint: {
        rating: run.targetHint.rating,
        recencyBucket: run.targetHint.recencyBucket as RecencyBucket,
        bodyFingerprint: run.targetHint.bodyFingerprint,
      },
      mode: "ABORT_REHEARSAL",
      createDriver: () => new HandleReplyComposerDriver(rowHandle, acquireComposer, waitSubmit),
      persistDir,
    });
    session = assembly.session;
    session.attach();
    const client = new ReplyRunOperatorClient(channel.client, replyRunId);
    const isTerminal = () => ["OPERATOR_REPORTED", "FAILED", "CANCELLED"].includes(client.view?.status ?? "");

    // The abort watch is NOT started here. It opens at the composer barrier, below, for two reasons that
    // both produced wrong records:
    //
    //   (a) STALENESS. `watchForAbort` is the one wait site that does not clear its sentinel before
    //       waiting — the class fixed inside `waitForFile`/`waitForEither`, surviving one layer upstream.
    //       The only clear happens before `launchNaverContext`, up to three operator prompts earlier. An
    //       operator who pre-creates their sentinels (documented behaviour, and the exact bug that nearly
    //       let the re-render gate pass) would have this fire on its FIRST synchronous iteration, before
    //       `START_RUN` — the engine rejects the abort as not-started, the watcher exits, and the run walks
    //       to the composer with no abort watcher at all while the prompt says otherwise.
    //   (b) SCOPE. `SWITCH_TO_MANUAL` is accepted at every live stage, so a sentinel arriving during
    //       LOCATE_ROW reports SUBMISSION_ABORTED and the record claims terminal COMPOSER_ABORT with
    //       `reachedBarrier: false` and only two barriers re-verified — the milestone's success terminal
    //       stamped on a run that never reached a composer.
    //
    // Opening it at the barrier makes the watch mean what the prompt says: this abort is about THIS
    // composer. It is also the only point from which the timeout is honest — starting it here gave a 15
    // minute window on a path that can legitimately take 25.
    client.send("START_RUN", {
      channelCode: REPLY_CHANNEL_CODE,
      intent: "REPLY_SUBMISSION",
      submissionRef: run.submissionRef,
    });

    let abortWatch: ReturnType<typeof watchForAbort> | null = null;

    const stageReached = async (target: ReplyStage): Promise<void> => {
      for (let i = 0; i < Math.ceil(BARRIER_TIMEOUT_MS / SENTINEL_POLL_INTERVAL_MS); i += 1) {
        if (barrierAbandoned || isTerminal() || assembly.engine.currentStage() === target) return;
        await sleep(SENTINEL_POLL_INTERVAL_MS);
      }
    };
    await stageReached("WAIT_FOR_SUBMIT");

    if (!isTerminal() && assembly.engine.currentStage() === "WAIT_FOR_SUBMIT") {
      reachedBarrier = true;
      try {
        const draft = await fetchApprovedReplyDraft(cfg.baseUrl, token, request.accountId, request.actionRef);
        if (draft.approved && draft.draftBody) {
          await evalOn<boolean>(activePage, renderDraftOverlay(draft.draftBody));
          draftDisplayed = true;
          console.error("Approved draft is shown read-only (bottom-right SellerOps panel). Do NOT paste it.");
        } else {
          console.error("No approved draft body to display; proceeding to the abort confirmation.");
        }
      } catch {
        console.error("Could not load the approved draft for display; proceeding to the abort confirmation.");
      }
      console.error(
        [
          "",
          "The reply COMPOSER is HIGHLIGHTED (green). Confirm it is where your approved reply would go.",
          "Do NOT type, paste, or submit anything. To end the session:",
          `  aborted → ${abortedSentinel}`,
          "This mode can ONLY end as SUBMISSION_ABORTED. (Ctrl-C also aborts.)",
          "",
        ].join("\n"),
      );
      // Cleared immediately before watching, like every other wait in this file, so a sentinel created
      // before its own step cannot satisfy the step when it arrives.
      removeSentinel(abortedSentinel);
      abortWatch = watchForAbort(
        abortedSentinel,
        SUBMIT_WAIT_TIMEOUT_MS,
        SENTINEL_POLL_INTERVAL_MS,
        () => client.send("SWITCH_TO_MANUAL"),
        isTerminal,
      );
    }

    // Null when the barrier never opened: there was no composer to abort at, so there is no outcome to
    // wait for, and the run winds down to a stop terminal instead of hanging for the full barrier timeout.
    const outcome = abortWatch === null ? null : await abortWatch;
    if (outcome === "aborted") {
      await assembly.session.whenSettled();
    } else if (outcome === null) {
      console.error("No abort within the window; ending without recording an outcome.");
    }

    const view = client.view;
    const reported = assembly.engine.events().find((e) => e.type === "SUBMISSION_REPORTED");
    operatorOutcome = (reported?.payload as { operatorOutcome?: string } | undefined)?.operatorOutcome ?? null;
    runVerification = (reported?.payload as { verification?: string } | undefined)?.verification ?? null;
    // A drift detected at the entry barrier cannot `return` (it is inside the driver's acquire callback), so
    // it sets the terminal and lets the run wind down. Overwriting it here would stamp the milestone's
    // SUCCESS terminal on the exact safety event the barrier exists to catch.
    // (Keyed off driftReason rather than the terminal: barriers 1 and 2 return, so a drift reason surviving
    // to here can only have come from the entry barrier inside the driver callback.)
    if (driftReason === null) {
      terminal = operatorOutcome ? "COMPOSER_ABORT" : "COMPOSER_NOT_REACHED";
    }
    log("aw.guided.run", { status: view?.status, entry: entryTransition ?? "none" });

    // A drifted run's outcome is not posted: the local terminal is ACCOUNT_DRIFTED, and recording an abort
    // against the action would present a safety stop as an ordinary operator decision.
    if (operatorOutcome && driftReason === null) {
      try {
        const rec = await submitReplyOutcome(cfg.baseUrl, token, request.accountId, request.actionRef, {
          commandId: `outcome-${replyRunId}`,
          submissionRef: run.submissionRef,
          operatorOutcome,
          awRunRef: replyRunId,
        });
        console.error(`Backend outcome recorded (recorded=${rec.recorded}, replayed=${rec.replayed}).`);
      } catch {
        console.error("Could not record the outcome on the backend; the local terminal stands.");
      }
    }
  } finally {
    for (const p of ctx.pages()) {
      await evalOn<number>(p as Page, IN_PAGE_ID_OUTLINE_TEARDOWN).catch(() => undefined);
      await evalOn<boolean>(p as Page, COMPOSER_TEARDOWN).catch(() => undefined);
    }
    void session;
    for (const s of allSentinels) removeSentinel(s);
    await ctx.close();
  }
  } catch {
    // The record is still written below. Without this the terminal would keep whatever stage it had reached
    // — e.g. OPERATOR_NOT_READY — beside a MATCHing preflight, which reads as a contradiction rather than a
    // crash. Details are suppressed here for the same reason as the top-level catch.
    terminal = "RUN_FAILED";
    process.exitCode = 1;
    console.error("The guided session ended on an unexpected error; the run record below records the stop.");
  } finally {
  const record = buildGuidedRecord({
    runId,
    terminal,
    session: chromeResult,
    boundThisRun,
    reverifiedAtBarriers,
    driftReason,
    locate,
    candidateRowCount,
    scanCount,
    rowsTruncated,
    tokensTruncated,
    outline,
    operatorConfirmed,
    entryTransition,
    reachedBarrier,
    draftDisplayed,
    operatorOutcome,
    verification: runVerification,
  });
  console.log(JSON.stringify(record, null, 2));

  try {
    const dir = resolve(collectorRoot, RUN_RECORD_REL_DIR);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(dir, `${runId}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  } catch {
    console.error("Could not persist the run record; the printed record above is the only copy.");
  }
  }
}

export interface GuidedRecordInput {
  runId: string;
  terminal: GuidedTerminal;
  session: ChromeReadResult | null;
  boundThisRun: boolean;
  reverifiedAtBarriers: number;
  driftReason: string | null;
  locate: LocateOutcome | null;
  candidateRowCount: number;
  scanCount: number;
  rowsTruncated: boolean;
  tokensTruncated: boolean;
  outline: OutlineOutcome | null;
  operatorConfirmed: boolean;
  entryTransition: TransitionKind | null;
  reachedBarrier: boolean;
  draftDisplayed: boolean;
  operatorOutcome: string | null;
  verification: string | null;
}

/**
 * Build the sanitized run record. Nothing identity-bearing may enter it: not the account id, the store token,
 * the review id, the review body, the draft, a URL, a selector, or any digest. Key NAMES are NAVER's own API
 * field names and are kept deliberately — they are what makes a later MISMATCH diagnosable.
 */
export function buildGuidedRecord(input: GuidedRecordInput): GuidedSessionRecord {
  const v = input.session?.verification;
  return {
    runId: input.runId,
    channel: REPLY_CHANNEL_CODE,
    terminal: input.terminal,
    session: {
      verdict: v?.verdict ?? "UNAVAILABLE",
      reason: v?.reason ?? "preflight-not-run",
      // The shop name is stored by explicit product-owner decision; the USER ID never is.
      observedShopName: v?.observedShopName ?? null,
      boundShopDisplayName: v?.boundShopDisplayName ?? null,
      shopNameDiffers: v?.shopNameDiffers ?? false,
      boundThisRun: input.boundThisRun,
      userIdSelectorIndex: input.session?.userIdSelectorIndex ?? -1,
      shopNameSelectorIndex: input.session?.shopNameSelectorIndex ?? -1,
      reverifiedAtBarriers: input.reverifiedAtBarriers,
      driftReason: input.driftReason,
    },
    review: {
      matched: input.locate?.matched ?? false,
      matchMode: input.locate?.matched ? input.locate.mode : null,
      failureReason: input.locate && !input.locate.matched ? input.locate.reason : null,
      matchCount: input.locate?.matchCount ?? 0,
      matchedSource: input.locate?.matched ? input.locate.source : null,
      candidateRowCount: input.candidateRowCount,
      scanCount: input.scanCount,
      rowsTruncated: input.rowsTruncated,
      tokensTruncated: input.tokensTruncated,
      outline: input.outline,
      operatorConfirmed: input.operatorConfirmed,
    },
    composer: {
      entryTransition: input.entryTransition,
      reachedBarrier: input.reachedBarrier,
      draftDisplayed: input.draftDisplayed,
      draftEntered: false,
      operatorOutcome: input.operatorOutcome,
      verification: input.verification,
    },
    // Belt and braces: a drift stop can never claim verification even if a stale MATCH were somehow passed
    // in. `driftReason` is set only when a barrier re-check failed.
    sellerAccountBinding:
      v?.verdict === "MATCH" && input.driftReason === null
        ? "verified-against-open-session"
        : "not-verified-against-session",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e: unknown) => {
    // Playwright errors embed the page URL and the evaluated source; only the category may surface.
    const category = e instanceof Error ? e.constructor.name : typeof e;
    console.error(`The guided session failed (${category}). Details are suppressed to keep the run sanitized.`);
    process.exitCode = 1;
  });
}
