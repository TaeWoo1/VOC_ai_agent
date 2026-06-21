/**
 * Live same-session SYNC CAPTURE — one human-attended, single-click export run.
 *
 *   set -a && . ./.env && set +a   # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run capture-export-same-session -- --i-understand-this-opens-live-naver
 *
 * Why this exists: the cold auto-navigation full-capture path (`discover-export
 * --discover`) opens a FRESH context and programmatically navigates to the review
 * route, which NAVER Commerce answers with a reconnect / account-selection
 * interstitial (`RECONNECT_REQUIRED`) — so the export click → download → upload leg
 * has never actually run. This CLI is the validation BRIDGE: it mirrors the read-only
 * `classify-export-same-session` sentinel flow, but after the human has logged in,
 * selected the account/store, and navigated to the loaded export page IN THE SAME
 * session, it performs ONE guarded sync capture on that page and uploads it to the
 * local dev backend. It proves the real capture leg on the already-proven same-session
 * state instead of a cold re-navigation. It is NOT the final unattended path.
 *
 * STRICT GUARDS — the click only ever happens when ALL hold:
 *   - the five-state verdict is `LOGGED_IN` (`checkLiveSessionVerdict`),
 *   - the no-click plan (`planExportAction`) says `SYNC_DOWNLOAD`, no async marker,
 *     exactly one actionable candidate AND one trigger selector (`decideCaptureGate`),
 *   - `runExport({ strictSingleCandidate: true })` re-classifies and refuses anything
 *     but a single sync control, clicking once with no fallback loop.
 * Any other shape HALTS with an honest status and never clicks. Two independent checks
 * must both say "single sync control" before a single download is triggered.
 *
 * CONTINUATION: like the other same-session CLIs it does NOT read a terminal keypress
 * (the harness can't reliably deliver Enter). It polls for the SAME sentinel file whose
 * exact absolute path it prints; create that file when ready. Run only ONE same-session
 * CLI at a time — they share the sentinel path.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run approval flag.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { loadConfig, type CollectorConfig } from "../config";
import { log } from "../log";
import {
  diagnoseExportClickOnce,
  type DiagContext,
  type DiagPage,
  type ExportClickDiagnosis,
} from "../naver/export-click-diagnose";
import { planExportAction } from "../naver/export-classify";
import { evaluateExportTargetReadiness } from "../naver/export-target-readiness";
import { waitForSpaHydration } from "../naver/hydration";
import { resolveReconnectIfNeeded, type ReconnectResolution } from "../naver/reconnect-resolve";
import { checkLiveSessionVerdict } from "../naver/session-check";
import type { SessionVerdict } from "../naver/session-verdict";
import { runExport } from "../naver/review-export";
import { launchNaverContext, type PwPage } from "../profile";
import { decideState, writeStatus, type RunSignals } from "../status";
import { login, resolveChannelId, uploadReviewFile, UploadError } from "../upload";
import { waitForCaptureStartState } from "./capture-start-state";
import { approvalRequiredMessage, hasLiveRunApproval, isClassifyOnly } from "./live-run-approval";
import { decideCaptureGate, type CaptureGateDecision } from "./same-session";
import { sentinelPathFor } from "./probe-sentinel";

// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give
// them plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;
// Auto-read default: re-settle + re-read the verdict on this cadence until a resolvable
// start state (LOGGED_IN / RECONNECT_REQUIRED) appears or the timeout elapses.
const START_POLL_INTERVAL_MS = 1_500;
// --diagnose-export-click: after the gate permits, click ONCE and observe (no capture,
// no upload, no status) what the click produced for a slow, bounded window.
const DIAGNOSE_OBSERVE_WINDOW_MS = 45_000;
const DIAGNOSE_POLL_INTERVAL_MS = 3_000;
const DIAGNOSE_CLICK_TIMEOUT_MS = 8_000;
// Read-only post-continue stabilization: settle + re-read until the page is a logged-in
// actionable sync export surface (or halt). Patient enough to outlast cold-context hydration.
const POST_CONTINUE_STABILIZE_TIMEOUT_MS = 20_000;
const POST_CONTINUE_STABILIZE_INTERVAL_MS = 1_500;

/** Shown in auto-read (default) mode after the browser opens — no ready file is needed. */
const AUTO_READ_PROMPT = [
  "",
  "auto-read mode: complete manual login if prompted; the CLI will detect LOGGED_IN or",
  "RECONNECT_REQUIRED automatically (no ready file needed). Leave the browser OPEN.",
  "A RECONNECT_REQUIRED screen is resolved by the guarded continue; login/2FA/unknown are",
  "waited through until they clear or the timeout halts the run. (Ctrl-C to abort.)",
].join("\n");

/** Prompt shown after the browser opens. The exact sentinel path is printed below it. */
const CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Select the account / store and enter the SmartStore Center review-management",
  "     / export page, with the export controls visibly loaded.",
  "  3) Leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  "just say \"ready\" and Claude creates it). The collector is polling for it and will",
  "then verify the session + export layout and, ONLY for a single unambiguous sync",
  "control, click it ONCE, capture the download, and upload it to the LOCAL dev",
  "backend. If anything is ambiguous it halts WITHOUT clicking. (Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER same-session capture — explicit per-run approval required.");
  console.error(" A human logs in; the collector clicks at most ONE sync export control,");
  console.error(" captures one file, and uploads it to the LOCAL dev backend only.");
  console.error(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build the sanitized classify-only (dry-run) report. Field-by-field by design: only
 * enums (verdicts/decision/outcome/state) and booleans are emitted — never page text,
 * URL, HTML, id, or token. `gate` is absent on a pre-export halt; then `wouldCapture`
 * is false and `gateState` falls back to the halt state.
 */
function classifyOnlyReport(
  preVerdict: SessionVerdict,
  resolution: ReconnectResolution,
  gate?: CaptureGateDecision,
): string {
  return JSON.stringify({
    mode: "classify-only",
    preVerdict,
    decision: resolution.decision,
    resolvedVerdict: resolution.resolvedVerdict,
    continueOutcome: resolution.continueOutcome,
    reachedExportSurface: resolution.reachedExportSurface,
    wouldCapture: gate?.proceed ?? false,
    gateState: gate?.state ?? resolution.halt?.state,
  });
}

/**
 * Sanitized report for `--diagnose-export-click` when the run HALTS before the click
 * (a pre-step reconnect halt, or the export gate refusing). Enums/booleans only — it
 * mirrors the no-status discipline of the classify-only dry-run.
 */
function diagnoseHaltReport(
  preVerdict: SessionVerdict,
  resolution: ReconnectResolution,
  gate?: CaptureGateDecision,
): string {
  return JSON.stringify({
    mode: "diagnose-export-click",
    halted: true,
    preVerdict,
    decision: resolution.decision,
    resolvedVerdict: resolution.resolvedVerdict,
    gateState: gate?.state ?? resolution.halt?.state,
    wouldClick: gate?.proceed ?? false,
  });
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
 * on timeout. Bounded by a fixed iteration count (no wall-clock read). The caller
 * clears any stale sentinel BEFORE calling this, so a hit only ever reflects a
 * post-startup creation.
 */
async function waitForSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return true;
    await sleep(intervalMs);
  }
  return existsSync(path);
}

/**
 * Past the gate (`LOGGED_IN` + single sync control): trigger the ONE guarded capture and,
 * on a real CAPTURED file, upload it through the existing offline-core client. This is the
 * ONLY path that clicks/captures. `strictSingleCandidate` makes the one-click bound
 * structural inside `runExport`. Mirrors `discover-export.ts:doDiscoverFullCapture`, minus
 * the cold-navigation front-end.
 */
async function captureAndUpload(
  page: PwPage,
  cfg: CollectorConfig,
  now: () => string,
): Promise<void> {
  const base: RunSignals = { paired: true, session: "LOGGED_IN" };

  const { outcome, filePath } = await runExport(page, cfg.downloadDir, {
    classifyOnly: false,
    strictSingleCandidate: true,
  });

  if (outcome !== "CAPTURED" || !filePath) {
    const state = decideState({ ...base, exportOutcome: outcome });
    writeStatus(cfg.statusFile, { state, detail: `export outcome: ${outcome}`, updatedAt: now() });
    log("run.done", { state, outcome });
    return;
  }

  // Sync capture → upload through the existing offline-core client (no new path). The
  // captured filename can carry store/date — it is used only as the on-disk path and the
  // upload basename; the status detail is row counts only, never the filename.
  let uploadOutcome: "OK" | "FAILED" = "OK";
  let detail = "";
  try {
    const token = await login(cfg.baseUrl, cfg.email, cfg.password);
    const channelId = await resolveChannelId(cfg.baseUrl, token, cfg.naverChannelCode);
    const result = await uploadReviewFile(cfg.baseUrl, token, channelId, filePath);
    detail = `inserted ${result.successRows}, skipped ${result.skippedRows}, failed ${result.failedRows}`;
  } catch (error) {
    uploadOutcome = "FAILED";
    detail = `upload failed at ${error instanceof UploadError ? error.stage : "unknown"}`;
  }
  const state = decideState({ ...base, exportOutcome: "CAPTURED", uploadOutcome });
  writeStatus(cfg.statusFile, {
    state,
    detail,
    lastCollectedAt: uploadOutcome === "OK" ? now() : undefined,
    updatedAt: now(),
  });
  log("run.done", { state });
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
  const now = (): string => new Date().toISOString();

  // Readiness mode. DEFAULT = auto-read: after the human completes manual login, the CLI
  // polls the page itself and proceeds on the first resolvable start verdict — no "ready"
  // hand-off. Opt into the legacy manual ready-file flow with --require-sentinel/--sentinel;
  // --no-sentinel / --auto-read-after-hydration are explicit auto-read aliases (and override
  // sentinel mode if both are passed).
  const sentinelMode =
    (args.includes("--require-sentinel") || args.includes("--sentinel")) &&
    !args.includes("--no-sentinel") &&
    !args.includes("--auto-read-after-hydration");

  // Single source of truth for the continuation file; clear any stale sentinel BEFORE
  // waiting so a leftover from a crashed run can never auto-proceed.
  const sentinelPath = sentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as unknown as PwPage;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce select.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Reach a resolvable start verdict (LOGGED_IN or RECONNECT_REQUIRED). The human still
    //    logs in / clears 2FA manually; how we then detect readiness depends on the mode.
    let verdict: SessionVerdict;
    if (sentinelMode) {
      // Legacy opt-in: hand off to the human and wait for the sentinel file (not stdin).
      console.error(CONFIRM_PROMPT);
      console.error("");
      console.error(`  Sentinel file (create this when ready):`);
      console.error(`    ${sentinelPath}`);
      console.error("");
      const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
      if (!ready) {
        // Never act on a half-loaded page on a timeout — abort cleanly without reading or clicking.
        console.error("No sentinel within the timeout; aborting without reading the page.");
        log("capture.aborted", { reason: "sentinel-timeout" });
        return;
      }
      // Read the page AS THE HUMAN LEFT IT (no re-navigation), with a bounded hydrate first.
      const hydration = await waitForSpaHydration(page);
      log("session.hydration", { result: hydration });
      verdict = await checkLiveSessionVerdict(page);
    } else {
      // DEFAULT: auto-read. Poll the page ourselves — settle + read the verdict — and proceed
      // on the first resolvable start state. Login/2FA/unknown are waited through; a window
      // with no resolvable state HALTS honestly WITHOUT clicking or reading raw content.
      console.error(AUTO_READ_PROMPT);
      const start = await waitForCaptureStartState(page, {
        timeoutMs: CONFIRM_TIMEOUT_MS,
        intervalMs: START_POLL_INTERVAL_MS,
        settleFn: waitForSpaHydration,
        checkVerdictFn: checkLiveSessionVerdict,
      });
      if (start.kind === "TIMEOUT") {
        console.error("No resolvable start state within the timeout; halting without clicking.");
        log("capture.aborted", { reason: "auto-read-timeout", checks: start.checks });
        return;
      }
      log("session.start", { verdict: start.verdict, checks: start.checks });
      verdict = start.verdict;
    }

    // 4) PRE-STEP: if the human-left page is the Commerce reconnect-continue screen, resolve it
    //    with ONE guarded continue click — but ONLY when every guard holds (verified inside the
    //    boundary). LOGGED_IN passes straight through (the boundary is never invoked); everything
    //    ambiguous HALTS without clicking. Continue success is NOT collection success.
    const classifyOnly = isClassifyOnly(args);
    // Diagnostic mode: click ONCE through the existing gate and observe — never upload,
    // never write status. classify-only (NO click) takes precedence if both are passed.
    const diagnoseClick = !classifyOnly && args.includes("--diagnose-export-click");
    const resolution = await resolveReconnectIfNeeded(page as unknown as Page, ctx, verdict, {
      expected: {
        expectedChannelCode: cfg.naverExpectedChannelCode,
        expectedStoreFingerprint: cfg.naverExpectedStoreFingerprint,
      },
      salt: cfg.storageProbeSalt,
      expectedContinueCard: { expectedCardFingerprint: cfg.naverExpectedContinueCardFingerprint },
      fingerprintConfigured: cfg.naverExpectedContinueCardFingerprint !== undefined,
      // Read-only post-continue stabilization: if the continue advances but its post-click
      // read is weak/unstable, settle + re-read (verdict + no-click export plan) until the
      // page is a logged-in actionable sync surface, or halt. Never clicks/exports/uploads.
      stabilize: {
        timeoutMs: POST_CONTINUE_STABILIZE_TIMEOUT_MS,
        intervalMs: POST_CONTINUE_STABILIZE_INTERVAL_MS,
        settleFn: waitForSpaHydration,
        checkVerdictFn: checkLiveSessionVerdict,
        readExportPlanFn: async (p) => planExportAction(await p.content()),
      },
    });
    if (resolution.decision === "HALT") {
      // A diagnostic / dry-run reports only and persists NOTHING; a real run records the
      // honest halt state.
      if (classifyOnly) {
        console.log(classifyOnlyReport(verdict, resolution));
      } else if (diagnoseClick) {
        console.log(diagnoseHaltReport(verdict, resolution));
      } else {
        const halted = resolution.halt!;
        writeStatus(cfg.statusFile, { state: halted.state, detail: halted.detail, updatedAt: now() });
      }
      log("run.halted", { state: resolution.halt!.state });
      return;
    }

    // 5) Canonical re-read for the EXPORT decision — identical inputs to before. Continue never
    //    changes the export gate logic; on a LOGGED_IN pass-through this reads the page as-is.
    const exportVerdict = await checkLiveSessionVerdict(page);
    const html = await page.content();
    const plan = planExportAction(html);

    // 6) The single export chokepoint: only an unambiguous single sync control on a LOGGED_IN
    //    session proceeds to the click. Everything else halts with an honest status.
    const gate = decideCaptureGate(exportVerdict, plan);

    // 6b) Second, narrower gate: a single sync control EXISTS, but is there anything to export?
    //     Evaluated read-only from the SAME page HTML (no extra read, no click). Only positive
    //     evidence of exportable rows is READY; empty/date-range/ambiguous HALT before the click.
    const readiness = evaluateExportTargetReadiness(html);
    // --diagnose-allow-empty-target: in DIAGNOSTIC mode only, intentionally click into a
    // not-READY surface for further observation. Never affects real capture mode.
    const allowEmptyTarget = diagnoseClick && args.includes("--diagnose-allow-empty-target");

    // 7) DRY-RUN (classify-only): report the would-capture decision and STOP before any click,
    //    download, upload, or status write.
    if (classifyOnly) {
      console.log(classifyOnlyReport(verdict, resolution, gate));
      log("run.classify-only", { wouldCapture: gate.proceed, state: gate.state });
      return;
    }

    // 7b) DIAGNOSE (one observed click): only past the SAME gate, click ONCE and observe
    // what it produced. No capture/upload/status — `noStatusMode` keeps this leg honest.
    if (diagnoseClick) {
      if (!gate.proceed) {
        console.log(diagnoseHaltReport(verdict, resolution, gate));
        log("run.halted", { state: gate.state });
        return;
      }
      // Safe-by-default: do NOT click into a not-READY target unless explicitly overridden.
      // Report the readiness verdict (sanitized) and STOP — no status, no upload, no capture.
      if (readiness.decision !== "READY" && !allowEmptyTarget) {
        console.log(
          JSON.stringify({
            mode: "diagnose-export-click",
            halted: true,
            gateState: gate.state,
            targetReadiness: readiness.decision,
            targetState: readiness.state,
            reason: readiness.reason,
            wouldClick: false,
          }),
        );
        log("run.halted", { state: readiness.state });
        return;
      }
      const diagnosis: ExportClickDiagnosis = await diagnoseExportClickOnce(
        page as unknown as DiagPage,
        ctx as unknown as DiagContext,
        {
          observeWindowMs: DIAGNOSE_OBSERVE_WINDOW_MS,
          pollIntervalMs: DIAGNOSE_POLL_INTERVAL_MS,
          clickTimeoutMs: DIAGNOSE_CLICK_TIMEOUT_MS,
          salt: cfg.storageProbeSalt,
          settleFn: (p) => waitForSpaHydration(p as unknown as PwPage),
        },
      );
      console.log(
        JSON.stringify({
          mode: "diagnose-export-click",
          gateState: gate.state,
          targetReadiness: readiness.decision,
          ...diagnosis,
        }),
      );
      log("run.diagnose-export-click", { outcome: diagnosis.outcome, clicked: diagnosis.clickedCount });
      return;
    }

    if (!gate.proceed) {
      writeStatus(cfg.statusFile, { state: gate.state, detail: gate.detail, updatedAt: now() });
      log("run.halted", { state: gate.state });
      return;
    }

    // 7c) EXPORT-TARGET readiness halt (real capture): the control exists, but there is
    //     nothing to export under the current condition. Record the honest state and STOP
    //     before the click — no download, no upload, no LAST_SUCCESS.
    if (readiness.decision !== "READY") {
      writeStatus(cfg.statusFile, {
        state: readiness.state,
        detail: `export-target not ready: ${readiness.reason}`,
        updatedAt: now(),
      });
      log("run.halted", { state: readiness.state });
      return;
    }

    await captureAndUpload(page, cfg, now);
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
