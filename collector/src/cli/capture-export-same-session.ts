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
import { join } from "node:path";
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
import {
  decideApprovedIndexConfirm,
  decideReviewUsageConfirm,
  decideSaveReviewDownload,
  decideStatusSignalsAfterUpload,
  decideSupervisedExportReady,
  decideUploadSavedReviewDownload,
  diagnosePreClickSignals,
  statusDetailAfterUpload,
  parseApprovedIndexArg,
  type PreClickSignals,
} from "../naver/export-click-signals";
import {
  confirmReviewUsageByIndexOnce,
  confirmReviewUsageOnce,
  scanReviewUsageConfirmCandidates,
  type ConfirmContext,
  type ConfirmDownload,
  type ConfirmPage,
  type ReviewUsageCandidatesResult,
  type ReviewUsageConfirmIndexResult,
  type ReviewUsageConfirmResult,
} from "../naver/review-usage-confirm";
import { saveAndInspectDownload } from "../naver/review-download-save";
import { uploadSavedReviewDownload } from "../naver/review-upload-diagnostic";
import { evaluateExportTargetReadiness } from "../naver/export-target-readiness";
import {
  waitForExportTargetReadinessStable,
  type ExportTargetReadinessStableDeps,
} from "../naver/export-target-readiness-stable";
import { probeLiveExportTargetReadiness } from "../naver/live-export-target-probe";
import { readLiveProbeSignals } from "../naver/live-export-target-probe-reads";
import { waitForSpaHydration } from "../naver/hydration";
import { resolveReconnectIfNeeded, type ReconnectResolution } from "../naver/reconnect-resolve";
import { checkLiveSessionVerdict } from "../naver/session-check";
import type { SessionVerdict } from "../naver/session-verdict";
import { runExport } from "../naver/review-export";
import { launchNaverContext, type PwPage } from "../profile";
import { decideState, writeStatus, type CollectorState, type RunSignals } from "../status";
import { login, resolveChannelId, uploadReviewFile, UploadError } from "../upload";
import { waitForCaptureStartState } from "./capture-start-state";
import { approvalRequiredMessage, hasLiveRunApproval, isClassifyOnly } from "./live-run-approval";
import { decideCaptureGate, type CaptureGateDecision } from "./same-session";
import type { OperatorConfirmAsk } from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";
import {
  OBSERVED_BY_AUTO_READ,
  actionBarrierRefusedMessage,
  barrierRefusedRecord,
  confirmActionBarrier,
} from "./operator-action-barrier";

// The human may need to clear 2FA/CAPTCHA and the Commerce account/store flow; give
// them plenty of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
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
// Read-only export-target readiness stabilization: past the gate, poll the results read-only
// across the FULL bounded window (only READY short-circuits) — so a still-rendering table is
// never misread as empty on an early read. Bounded; never clicks.
const EXPORT_TARGET_READINESS_STABILIZE_TIMEOUT_MS = 15_000;
const EXPORT_TARGET_READINESS_STABILIZE_INTERVAL_MS = 1_500;
// Read-only LIVE-DOM disambiguation poll: when the HTML-only readiness HALTS in DIAGNOSTIC mode,
// ask the rendered page (visible rows / visible empty placeholder / frames) whether the static
// "empty" is a false positive. Diagnostic-only — never changes a gate decision, never clicks.
const LIVE_EXPORT_TARGET_PROBE_TIMEOUT_MS = 8_000;
const LIVE_EXPORT_TARGET_PROBE_INTERVAL_MS = 1_500;
// SUPERVISED-FAST diagnostic readiness: in `--diagnose-allow-empty-target` mode the HTML
// `EXPORT_TARGET_EMPTY` reading is a known false positive, so we do NOT consume the full
// readiness stabilization window. Settle briefly (read-only) for the sync export control to
// become actionable, then take the existing single diagnostic click. Bounded; never clicks.
const SUPERVISED_SETTLE_TIMEOUT_MS = 4_000;
const SUPERVISED_SETTLE_INTERVAL_MS = 1_000;

/** Shown in auto-read (default) mode after the browser opens — no ready file is needed. */
const AUTO_READ_PROMPT = [
  "",
  "auto-read mode: complete manual login if prompted; the CLI will detect LOGGED_IN or",
  "RECONNECT_REQUIRED automatically (no ready file needed). Leave the browser OPEN.",
  "A RECONNECT_REQUIRED screen is resolved by the guarded continue; login/2FA/unknown are",
  "waited through until they clear or the timeout halts the run. (Ctrl-C to abort.)",
].join("\n");

/**
 * What the operator is asked to do, and confirm, in the opt-in hand-off mode.
 *
 * It used to end with "just say \"ready\" and Claude creates it" — the channel that failed on 2026-08-13, and
 * the one this run could least afford: what follows a confirmation here is a real click on a real export control.
 */
const CONFIRM_ASK: OperatorConfirmAsk = {
  title: "NAVER 내보내기 캡처",
  headline: "내보내기 화면에 직접 도착한 뒤 확인해 주세요 — 확인 뒤에 실제 클릭이 일어납니다.",
  lines: [
    "A browser window is open on NAVER. In that SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Select the account / store and enter the SmartStore Center review-management",
    "     / export page, with the export controls visibly loaded.",
    "  3) Leave the browser OPEN.",
    "",
    "Then press [현재 화면 확인] in the SellerOps confirmation tab — nothing else advances this run. It will",
    "then verify the session + export layout and, ONLY for a single unambiguous sync",
    "control, click it ONCE, capture the download, and upload it to the LOCAL dev",
    "backend. If anything is ambiguous it halts WITHOUT clicking.",
  ],
};

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

/** Result of the read-only supervised-fast settle — sanitized scalars only. */
interface SupervisedExportReadiness {
  ready: boolean;
  preClick: PreClickSignals;
  checks: number;
  elapsedMs: number;
}

/**
 * SUPERVISED-FAST readiness settle (READ-ONLY): briefly poll the rendered page for the sync
 * export control to become actionable, short-circuiting as soon as `decideSupervisedExportReady`
 * is satisfied. Reads only (`waitForSpaHydration` + `page.content()` → pure pre-click signals) —
 * it NEVER clicks, exports, downloads, or writes status. Bounded by `SUPERVISED_SETTLE_TIMEOUT_MS`;
 * `elapsedMs` is derived from checks×interval (no wall-clock read).
 */
async function waitForSupervisedExportReady(page: PwPage): Promise<SupervisedExportReadiness> {
  const maxChecks = Math.max(1, Math.ceil(SUPERVISED_SETTLE_TIMEOUT_MS / SUPERVISED_SETTLE_INTERVAL_MS));
  let pre = emptyPreClick();
  let checks = 0;
  for (let i = 0; i < maxChecks; i += 1) {
    checks += 1;
    try {
      await waitForSpaHydration(page);
    } catch {
      // Mid-navigation settle failure — keep polling within the bound.
    }
    let html = "";
    try {
      html = await page.content();
    } catch {
      // Transient read during a re-render — skip this snapshot.
    }
    if (html) pre = diagnosePreClickSignals(html);
    if (decideSupervisedExportReady(pre)) break;
    if (i + 1 < maxChecks) await sleep(SUPERVISED_SETTLE_INTERVAL_MS);
  }
  return { ready: decideSupervisedExportReady(pre), preClick: pre, checks, elapsedMs: checks * SUPERVISED_SETTLE_INTERVAL_MS };
}

/** A pessimistic pre-click snapshot used before the first successful read (never ready). */
function emptyPreClick(): PreClickSignals {
  return {
    exportLayout: "LAYOUT_UNRECOGNIZED",
    exportActionable: false,
    dateRangeControlPresence: "none",
    selectedRangePresent: false,
    modalOpen: false,
    toastRegionPresent: false,
  };
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
  mode: "diagnose-export-click" | "capture-reviews" = "diagnose-export-click",
): string {
  return JSON.stringify({
    mode,
    halted: true,
    preVerdict,
    decision: resolution.decision,
    resolvedVerdict: resolution.resolvedVerdict,
    gateState: gate?.state ?? resolution.halt?.state,
    wouldClick: gate?.proceed ?? false,
  });
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
    // This file is a seller-center export the collector captured itself, not a human upload.
    const result = await uploadReviewFile(cfg.baseUrl, token, channelId, filePath, fetch,
      "SELLER_CENTER_EXPORT");
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

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The confirmation surface is a SellerOps-owned tab in the SAME window. `entryPage` is the operator's own
  // page, captured before that tab existed — this run reads that page and never the surface.
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => false,
    timeoutMs: CONFIRM_TIMEOUT_MS,
  });
  const page = confirmHost.entryPage as unknown as PwPage;
  try {
    // 1) Open the review route — this typically redirects to login / Commerce select.
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Reach a resolvable start verdict (LOGGED_IN or RECONNECT_REQUIRED). The human still
    //    logs in / clears 2FA manually; how we then detect readiness depends on the mode.
    let verdict: SessionVerdict;
    if (sentinelMode) {
      // Opt-in hand-off: the operator says the window is theirs to read, on the one channel that a
      // language model cannot produce.
      confirmHost.announce(CONFIRM_ASK);
      const confirmation = await confirmHost.confirm(CONFIRM_ASK);
      if (confirmation.signal !== "ready") {
        // Never act on a half-loaded page on a timeout — abort cleanly without reading or clicking.
        console.error("No confirmation press — aborting without reading the page.");
        log("capture.aborted", { reason: confirmation.signal });
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
      // The provenance of what advanced this run so far: a READING, not a decision. Recorded so the log says
      // which kind of evidence carried the run to the barrier — and so `AUTO_READ` is a value that exists in
      // the world rather than a type nothing produces.
      log("session.start", { verdict: start.verdict, checks: start.checks, observedBy: OBSERVED_BY_AUTO_READ });
      verdict = start.verdict;
    }

    // 4) PRE-STEP: if the human-left page is the Commerce reconnect-continue screen, resolve it
    //    with ONE guarded continue click — but ONLY when every guard holds (verified inside the
    //    boundary). LOGGED_IN passes straight through (the boundary is never invoked); everything
    //    ambiguous HALTS without clicking. Continue success is NOT collection success.
    const classifyOnly = isClassifyOnly(args);
    // PR C2a — NORMAL capture (non-diagnostic). `--capture-reviews` runs the SAME live-validated chain as
    // the diagnostic flags (supervised-fast readiness → one export click → SEMANTIC single-affirmative
    // confirm → save → upload → status) by turning the same internal switches on — zero chain duplication.
    // It deliberately does NOT enable approved-index mode, so the SEMANTIC confirm is always used (never a
    // hardcoded index). The bare default command (no flags) is unaffected and still runs captureAndUpload.
    const captureReviews = !classifyOnly && args.includes("--capture-reviews");
    // Diagnostic mode: click ONCE through the existing gate and observe — never upload,
    // never write status. classify-only (NO click) takes precedence if both are passed.
    const diagnoseClick = !classifyOnly && (args.includes("--diagnose-export-click") || captureReviews);
    // PR B: only after a supervised-fast click reaches REVIEW_USAGE_CONFIRMATION, press the consent
    // modal's 확인 ONCE — gated on the dedicated flag (never auto-confirmed). Active only inside the
    // supervised-fast (override) branch, which already requires --diagnose-allow-empty-target.
    const diagnoseConfirm = diagnoseClick && (args.includes("--diagnose-confirm-review-usage") || captureReviews);
    // Approved-index confirm (HIGHEST precedence): the operator inspected the candidate badges and now
    // approves ONE index to click. When set, it suppresses BOTH the no-click candidate scan and the
    // single-affirmative confirm click, so the report can never carry two click results. DIAGNOSTIC-ONLY:
    // `--capture-reviews` never sets this (it must use the semantic confirm, never a hardcoded index).
    const approvedIndexRequested = diagnoseClick && args.includes("--diagnose-confirm-review-usage-index");
    const approvedIndex = parseApprovedIndexArg(args);
    // NO-CLICK candidate-index diagnostic for the consent modal: badge visible modal buttons with
    // indices (human inspection) and report sanitized candidate metadata only. Never clicks. When set,
    // it takes precedence over the confirm-click step (which is suppressed). Suppressed in index mode.
    const diagnoseConfirmCandidates =
      diagnoseClick && args.includes("--diagnose-review-usage-confirm-candidates") && !approvedIndexRequested;
    // CONTROLLED DIAGNOSTIC SAVE: after an approved-index click fires a real download, save it to a
    // gitignored quarantine, validate it is a real .xlsx, then DELETE it. Never uploads/persists/writes
    // status. Active only in the approved-index path (the save hook is wired only there).
    const diagnoseSaveDownload = diagnoseClick && (args.includes("--diagnose-save-review-download") || captureReviews);
    // CONTROLLED BACKEND UPLOAD (higher-consequence): after the saved download validates as a real
    // .xlsx, upload it to the backend /api/uploads — which INGESTS rows into the backend DB. Inert
    // unless --diagnose-save-review-download is also set (you can only upload what was saved). Honestly
    // reported: emits upload/backendIngested (never dbMutated:false), writes no collector status.
    const diagnoseUpload =
      diagnoseSaveDownload && (args.includes("--diagnose-upload-saved-review-download") || captureReviews);
    // PR B: after the real upload, advance collector run-state via the EXISTING decideState/writeStatus
    // (no new states). Inert unless --diagnose-upload-saved-review-download is also set — you can only
    // write an upload outcome once an upload ran. This is the FIRST diagnostic path that writes
    // .status/naver.json; gated so the first status write is separately approved.
    const diagnoseWriteStatus =
      diagnoseUpload && (args.includes("--diagnose-write-status-after-upload") || captureReviews);
    // Report mode tag: a NORMAL `--capture-reviews` run is reported as "capture-reviews" (not the
    // diagnostic mode), even though it reuses the same validated chain underneath.
    const captureMode = captureReviews ? "capture-reviews" : "diagnose-export-click";
    // **ACTION BARRIER 1 — the guarded Commerce continue click.** `resolveReconnectIfNeeded` returns straight
    // through for `LOGGED_IN` without touching anything, so the ask is raised ONLY on the verdict that can
    // reach a click. The ordinary run never sees this screen, which is the point: a confirmation in front of
    // every read would be the thing that teaches operators to press without looking.
    if (verdict === "RECONNECT_REQUIRED") {
      const allowed = await confirmActionBarrier(confirmHost, {
        kind: "MARKETPLACE_CLICK",
        title: "계정 재연결 계속",
        headline: "재연결 화면의 '계속' 버튼을 SellerOps가 한 번 누르는 것을 허용하시겠습니까?",
        allows: [
          "재연결 화면의 '계속' 버튼을 정확히 한 번 누릅니다 (모든 확인 조건이 맞을 때만).",
          "누른 뒤의 화면이 안정될 때까지 읽기만 하며 기다립니다.",
        ],
        stillWillNot: "내보내기를 실행하거나, 파일을 저장하거나, 아무것도 전송하지 않습니다.",
      });
      if (!allowed) {
        console.error(actionBarrierRefusedMessage("MARKETPLACE_CLICK"));
        console.log(barrierRefusedRecord("MARKETPLACE_CLICK"));
        log("capture.aborted", { reason: "no-operator-confirmation-continue" });
        process.exitCode = 7;
        return;
      }
    }
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
        console.log(diagnoseHaltReport(verdict, resolution, undefined, captureMode));
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
    //     --diagnose-allow-empty-target: in DIAGNOSTIC mode only, intentionally click into a
    //     not-READY surface for further observation. Never affects real capture mode.
    const allowEmptyTarget = diagnoseClick && (args.includes("--diagnose-allow-empty-target") || captureReviews);
    // Bounded read-only readiness stabilization deps. Built once; the poll runs only past the
    // gate (in the diagnose / real-capture branches), never for the classify-only dry run.
    const readinessStabilizeDeps: ExportTargetReadinessStableDeps = {
      timeoutMs: EXPORT_TARGET_READINESS_STABILIZE_TIMEOUT_MS,
      intervalMs: EXPORT_TARGET_READINESS_STABILIZE_INTERVAL_MS,
      readHtmlFn: (p) => p.content(),
      evaluateReadinessFn: evaluateExportTargetReadiness,
    };

    // 7) DRY-RUN (classify-only): report the would-capture decision and STOP before the EXPORT click,
    //    download, upload, or status write.
    //
    //    ⚠ Not "before any click": the reconnect resolve above may click the Commerce continue control on a
    //    `RECONNECT_REQUIRED` verdict, and it does so on this path too. That click now has its own barrier
    //    (Barrier 1), but the comment claimed for years that classify-only clicked nothing at all.
    if (classifyOnly) {
      console.log(classifyOnlyReport(verdict, resolution, gate));
      log("run.classify-only", { wouldCapture: gate.proceed, state: gate.state });
      return;
    }

    // 7b) DIAGNOSE (one observed click): only past the SAME gate, click ONCE and observe
    // what it produced. No capture/upload/status — `noStatusMode` keeps this leg honest.
    if (diagnoseClick) {
      if (!gate.proceed) {
        console.log(diagnoseHaltReport(verdict, resolution, gate, captureMode));
        log("run.halted", { state: gate.state });
        return;
      }
      // **ACTION BARRIER 3 — the diagnostic click chain**, which `--capture-reviews` also runs. The flags say
      // what the operator INTENDED when they typed the command; they do not say that a person looked at the
      // page this run is now about to click on. The chain is disclosed from the flags actually set, so the
      // press covers exactly what this invocation will do and no more.
      const allowedDiagnostic = await confirmActionBarrier(confirmHost, {
        kind: "EXPORT_TRIGGER",
        title: captureReviews ? "리뷰 내보내기" : "내보내기 진단 클릭",
        headline: "지금 화면의 내보내기 컨트롤을 SellerOps가 한 번 눌러도 될까요?",
        allows: [
          "화면에서 하나로 확인된 내보내기 컨트롤을 정확히 한 번 누릅니다.",
          // `approvedIndexRequested` is set by its OWN flag and never consults `diagnoseConfirm`, so keying
          // this line off `diagnoseConfirm` alone hid a SECOND real click on the seller's consent modal —
          // the click that actually makes NAVER run the export — behind an ask that said "one control, once".
          ...(diagnoseConfirm || approvedIndexRequested
            ? ["이어서 뜨는 이용 동의 창의 '확인'을 한 번 누릅니다 (내보내기를 실제로 실행시키는 누름입니다)."]
            : []),
          ...(diagnoseSaveDownload ? ["내려받아진 파일 하나를 이 컴퓨터에 저장하고 검사합니다."] : []),
          ...(diagnoseUpload ? ["저장된 파일을 로컬 SellerOps 백엔드로 업로드합니다 (리뷰 데이터가 DB에 적재됩니다)."] : []),
          ...(diagnoseWriteStatus ? ["그 결과를 수집 상태 기록에 남깁니다."] : []),
        ],
        stillWillNot: diagnoseSaveDownload
          ? "다른 컨트롤을 누르거나, 화면의 값을 읽거나, 외부로 무엇도 보내지 않습니다."
          : "파일을 저장하거나, 업로드하거나, 상태를 기록하지 않습니다.",
      });
      if (!allowedDiagnostic) {
        console.error(actionBarrierRefusedMessage("EXPORT_TRIGGER"));
        console.log(barrierRefusedRecord("EXPORT_TRIGGER"));
        log("capture.aborted", { reason: "no-operator-confirmation-diagnostic" });
        process.exitCode = 7;
        return;
      }
      // 7b-fast) SUPERVISED-FAST (override only): the HTML `EXPORT_TARGET_EMPTY` readiness is a
      // KNOWN false positive on this surface, so `--diagnose-allow-empty-target` does NOT burn the
      // full ~15s stabilization window. Settle briefly (read-only) for the sync export control to
      // be actionable on the already-LOGGED_IN review-ready surface, then take the EXISTING single
      // diagnostic click. The non-override (stable) branch below is left unchanged.
      if (allowEmptyTarget) {
        const supervised = await waitForSupervisedExportReady(page);
        // Still conditional: the fast path replaces the false-positive empty wait with a SHORTER,
        // more relevant readiness check — it does NOT click blindly. If the sync export control is
        // not confirmed actionable within the settle, HALT and REPORT (no click), exactly like the
        // stable branch reports a not-READY halt.
        if (!supervised.ready) {
          console.log(
            JSON.stringify({
              mode: captureMode,
              halted: true,
              readinessMode: "supervised-fast",
              gateState: gate.state,
              supervisedReady: false,
              supervisedExportLayout: supervised.preClick.exportLayout,
              supervisedExportActionable: supervised.preClick.exportActionable,
              supervisedChecks: supervised.checks,
              supervisedElapsedMs: supervised.elapsedMs,
              clicked: false,
              clickedCount: 0,
              wouldClick: false,
            }),
          );
          log("run.halted", { state: "SUPERVISED_EXPORT_NOT_READY", readinessMode: "supervised-fast" });
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
        // Shared controlled-save deps — wired IDENTICALLY into both the approved-index and the SEMANTIC
        // single-affirmative confirm dispatch, so whichever path fires the download saves/validates (and,
        // with --diagnose-upload-saved-review-download, uploads to the backend before deletion) the same
        // way. Save only with --diagnose-save-review-download; the upload fn owns the only backend call
        // (the CLI never names uploadReviewFile here) and runs only when the file validates as a real .xlsx.
        const captureSaveDeps = diagnoseSaveDownload
          ? {
              saveDownloadFn: (d: ConfirmDownload) =>
                saveAndInspectDownload(d, {
                  dir: join(cfg.downloadDir, "diagnostic"),
                  salt: cfg.storageProbeSalt,
                  ...(diagnoseUpload
                    ? {
                        uploadFn: (p: string) =>
                          uploadSavedReviewDownload(p, {
                            baseUrl: cfg.baseUrl,
                            email: cfg.email,
                            password: cfg.password,
                            channelCode: cfg.naverChannelCode,
                            salt: cfg.storageProbeSalt,
                          }),
                      }
                    : {}),
                }),
            }
          : {};

        // Approved-index confirm (HIGHEST precedence): click EXACTLY the operator-approved candidate
        // index, ONCE — only when the flag carried a valid index AND the click reached consent. The
        // adapter rescans + re-validates the index live before binding, so a stale approval can't click
        // the wrong control. It suppresses the candidate scan + semantic confirm below.
        const approvedIndexDecision = decideApprovedIndexConfirm({
          outcome: diagnosis.outcome,
          indexRequested: approvedIndexRequested,
          parsedIndex: approvedIndex,
        });
        let approvedIndexResult: ReviewUsageConfirmIndexResult | undefined;
        if (approvedIndexDecision === "ATTEMPT" && approvedIndex !== null) {
          approvedIndexResult = await confirmReviewUsageByIndexOnce(
            page as unknown as ConfirmPage,
            ctx as unknown as ConfirmContext,
            {
              observeWindowMs: DIAGNOSE_OBSERVE_WINDOW_MS,
              pollIntervalMs: DIAGNOSE_POLL_INTERVAL_MS,
              salt: cfg.storageProbeSalt,
              settleFn: (p) => waitForSpaHydration(p as unknown as PwPage),
              ...captureSaveDeps,
            },
            approvedIndex,
          );
        }
        // The emitted decision is the adapter's refined verdict (ATTEMPT → REJECT_* on a live mismatch)
        // when it ran, else the pure pre-scan gate.
        const finalApprovedIndexDecision = approvedIndexResult?.approvedIndexDecision ?? approvedIndexDecision;

        // NO-CLICK candidate-index diagnostic (suppressed in approved-index mode): when set AND the click
        // reached consent, badge the modal buttons and report sanitized candidate metadata. NEVER clicks.
        let candidates: ReviewUsageCandidatesResult | undefined;
        if (diagnoseConfirmCandidates && diagnosis.outcome === "REVIEW_USAGE_CONFIRMATION") {
          candidates = await scanReviewUsageConfirmCandidates(page as unknown as ConfirmPage);
        }
        // SEMANTIC single-affirmative confirm: ONLY when --diagnose-confirm-review-usage is set AND the
        // click reached consent — and NOT in candidate or approved-index mode — bind the modal's SINGLE
        // affirmative 확인 (no index needed; halts on zero/multiple/disabled/invisible) and click it ONCE.
        // Carries the SAME captureSaveDeps, so the semantic path saves/uploads/validates identically.
        const confirmDecision = decideReviewUsageConfirm({
          outcome: diagnosis.outcome,
          confirmFlag: diagnoseConfirm && !diagnoseConfirmCandidates && !approvedIndexRequested,
        });
        let confirm: ReviewUsageConfirmResult | undefined;
        if (confirmDecision === "ATTEMPT") {
          confirm = await confirmReviewUsageOnce(page as unknown as ConfirmPage, ctx as unknown as ConfirmContext, {
            observeWindowMs: DIAGNOSE_OBSERVE_WINDOW_MS,
            pollIntervalMs: DIAGNOSE_POLL_INTERVAL_MS,
            salt: cfg.storageProbeSalt,
            settleFn: (p) => waitForSpaHydration(p as unknown as PwPage),
            ...captureSaveDeps,
          });
        }

        // Unified capture result — the approved-index and semantic confirm paths are MUTUALLY EXCLUSIVE,
        // so at most one ran. The downstream save / upload / status logic is identical regardless of which
        // fired the download; it reads the click/download/saved-inspection from whichever produced them.
        const captureClicked = approvedIndexResult?.approvedIndexClicked ?? confirm?.confirmClicked ?? false;
        const captureDownloadFired =
          approvedIndexResult?.postConfirmDownloadFired ?? confirm?.postConfirmDownloadFired ?? false;
        const savedDownload = approvedIndexResult?.savedDownload ?? confirm?.savedDownload;

        // Sanitized reason for the diagnostic-save step (and the invariant assertions it upholds).
        const downloadSaveReason = decideSaveReviewDownload({
          saveRequested: diagnoseSaveDownload,
          approvedIndexClicked: captureClicked,
          downloadFired: captureDownloadFired,
          saveSucceeded: savedDownload?.downloadSaved ?? false,
        });
        // Sanitized reason for the controlled backend-upload step. The sanitized ingest inspection
        // itself rides inside `savedDownload.uploaded` (spread via the index/confirm result).
        const uploadReason = decideUploadSavedReviewDownload({
          uploadRequested: diagnoseUpload,
          downloadSaved: savedDownload?.downloadSaved ?? false,
          xlsxReadable: savedDownload?.xlsxReadable ?? false,
          uploadSucceeded: savedDownload?.uploaded?.uploaded ?? false,
        });
        // Honest invariants: an UPLOADED reason means the backend DB WAS ingested. We never claim
        // dbMutated:false on the upload path; `upload` flags an attempt, `backendIngested` the real write.
        const uploadAttempted = uploadReason === "UPLOADED" || uploadReason === "UPLOAD_FAILED";
        const backendIngested = uploadReason === "UPLOADED";

        // PR B: ONLY when --diagnose-write-status-after-upload is set, advance collector run-state via the
        // EXISTING decideState/writeStatus (no new states). This is the only writeStatus in the supervised-
        // fast branch and it lives entirely inside this gate. lastCollectedAt is set ONLY on LAST_SUCCESS
        // (upload-success time via the same now() the real path uses); detail is SANITIZED (buckets only).
        let collectorStatusWritten = false;
        let writtenState: CollectorState | undefined;
        let statusDetail: string | undefined;
        if (diagnoseWriteStatus) {
          const statusSignals = decideStatusSignalsAfterUpload({
            downloadFired: captureDownloadFired,
            downloadSaved: savedDownload?.downloadSaved ?? false,
            xlsxReadable: savedDownload?.xlsxReadable ?? false,
            uploadReason,
            ingestStatusCategory: savedDownload?.uploaded?.ingestStatusCategory,
          });
          writtenState = decideState({
            paired: true,
            session: "LOGGED_IN",
            exportOutcome: statusSignals.exportOutcome,
            uploadOutcome: statusSignals.uploadOutcome,
          });
          statusDetail = statusDetailAfterUpload({ downloadSaveReason, uploadReason, uploaded: savedDownload?.uploaded });
          writeStatus(cfg.statusFile, {
            state: writtenState,
            detail: statusDetail,
            lastCollectedAt: writtenState === "LAST_SUCCESS" ? now() : undefined,
            updatedAt: now(),
          });
          collectorStatusWritten = true;
        }
        console.log(
          JSON.stringify({
            mode: captureMode,
            captureReviews,
            readinessMode: "supervised-fast",
            gateState: gate.state,
            supervisedReady: supervised.ready,
            supervisedExportLayout: supervised.preClick.exportLayout,
            supervisedExportActionable: supervised.preClick.exportActionable,
            supervisedChecks: supervised.checks,
            supervisedElapsedMs: supervised.elapsedMs,
            ...diagnosis,
            approvedIndexRequested,
            approvedIndex: approvedIndexRequested ? approvedIndex : null,
            approvedIndexDecision: finalApprovedIndexDecision,
            ...(approvedIndexResult ?? {}),
            downloadSaveRequested: diagnoseSaveDownload,
            downloadSaveReason,
            uploadRequested: diagnoseUpload,
            // The upload path is HONEST about backend DB ingestion: it emits `upload`/`backendIngested`
            // and NEVER `dbMutated:false`. With --diagnose-write-status-after-upload it ALSO writes the
            // mapped collector run-state, so `collectorStatusWritten`/`lastSuccessWritten` are honest
            // (true only when the status was actually written / the written state is LAST_SUCCESS).
            ...(diagnoseUpload
              ? {
                  upload: uploadAttempted,
                  uploadReason,
                  backendIngested,
                  diagnoseWriteStatusAfterUpload: diagnoseWriteStatus,
                  collectorStatusWritten,
                  ...(collectorStatusWritten ? { writtenState, statusDetail } : {}),
                  lastSuccessWritten: writtenState === "LAST_SUCCESS",
                }
              : diagnoseSaveDownload
                ? { upload: false, statusWritten: false, dbMutated: false, lastSuccessWritten: false }
                : {}),
            candidatesRequested: diagnoseConfirmCandidates,
            ...(candidates ?? {}),
            confirmRequested: diagnoseConfirm,
            confirmDecision,
            ...(confirm ?? {}),
          }),
        );
        log("run.diagnose-export-click", {
          outcome: diagnosis.outcome,
          clicked: diagnosis.clickedCount,
          readinessMode: "supervised-fast",
          approvedIndexDecision: finalApprovedIndexDecision,
          downloadSaveReason,
          uploadReason,
          collectorStatusWritten,
          writtenState: writtenState ?? "none",
          candidateScan: candidates?.candidateScan ?? "none",
          confirmDecision,
          confirmOutcome: confirm?.confirmOutcome ?? approvedIndexResult?.confirmOutcome ?? "none",
        });
        return;
      }
      // Read-only readiness stabilization (bounded poll) before considering the click.
      const stable = await waitForExportTargetReadinessStable(page, readinessStabilizeDeps);
      const readiness = stable.readiness;
      // Safe-by-default: do NOT click into a not-READY target unless explicitly overridden.
      // Report the (stabilized) readiness verdict and STOP — no status, no upload, no capture.
      if (readiness.decision !== "READY" && !allowEmptyTarget) {
        // Read-only LIVE-DOM disambiguation: the static HTML readiness may have matched a HIDDEN
        // empty-state placeholder while real rows render in a live grid / iframe. Ask the RENDERED
        // page. DIAGNOSTIC-ONLY — this enriches the halt report; it never changes the decision or
        // adds a click (`wouldClick` stays false). The pure poll reads only via the live adapter.
        const live = await probeLiveExportTargetReadiness(page, {
          timeoutMs: LIVE_EXPORT_TARGET_PROBE_TIMEOUT_MS,
          intervalMs: LIVE_EXPORT_TARGET_PROBE_INTERVAL_MS,
          readSignalsFn: readLiveProbeSignals,
        });
        console.log(
          JSON.stringify({
            mode: "diagnose-export-click",
            halted: true,
            gateState: gate.state,
            targetReadiness: readiness.decision,
            targetState: readiness.state,
            reason: readiness.reason,
            checks: stable.checks,
            stableCount: stable.stableCount,
            elapsedMs: stable.elapsedMs,
            liveProbe: live.decision,
            visibleRowCountBucket: live.visibleRowCountBucket,
            visibleEmptyState: live.visibleEmptyState,
            visibleGridLikeSurface: live.visibleGridLikeSurface,
            frameCountBucket: live.frameCountBucket,
            checkedFramesBucket: live.checkedFramesBucket,
            liveChecks: live.checks,
            liveElapsedMs: live.elapsedMs,
            wouldClick: false,
          }),
        );
        log("run.halted", { state: readiness.state, liveProbe: live.decision });
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
          checks: stable.checks,
          stableCount: stable.stableCount,
          elapsedMs: stable.elapsedMs,
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

    // 7c) EXPORT-TARGET readiness halt (real capture): the control exists, but is there
    //     anything to export? Stabilize read-only (a still-rendering table is not misread as
    //     empty), then on any non-READY settle record the honest state and STOP before the
    //     click — no download, no upload, no LAST_SUCCESS.
    const stable = await waitForExportTargetReadinessStable(page, readinessStabilizeDeps);
    const readiness = stable.readiness;
    if (readiness.decision !== "READY") {
      writeStatus(cfg.statusFile, {
        state: readiness.state,
        detail: `export-target not ready: ${readiness.reason} (checks ${stable.checks}, stable ${stable.stableCount})`,
        updatedAt: now(),
      });
      log("run.halted", { state: readiness.state });
      return;
    }

    // **ACTION BARRIER 2 — the capture chain.** One press, and the whole chain is disclosed on it: an operator
    // who allows "click the export control" and then finds a file on their disk and rows in a database has been
    // told less than they agreed to. Everything before this line was reading; nothing before it acted.
    const allowedCapture = await confirmActionBarrier(confirmHost, {
      kind: "EXPORT_TRIGGER",
      title: "리뷰 내보내기",
      headline: "지금 화면의 내보내기 컨트롤을 SellerOps가 한 번 눌러도 될까요?",
      allows: [
        "화면에서 하나로 확인된 내보내기 컨트롤을 정확히 한 번 누릅니다.",
        "그 결과로 내려받아진 파일 하나를 이 컴퓨터에 저장합니다.",
        "저장된 파일을 로컬 SellerOps 백엔드로 업로드합니다 (리뷰 데이터가 DB에 적재됩니다).",
        "그 결과를 수집 상태 기록에 남깁니다.",
      ],
      stillWillNot: "다른 컨트롤을 누르거나, 화면의 값을 읽거나, 외부로 무엇도 보내지 않습니다.",
    });
    if (!allowedCapture) {
      console.error(actionBarrierRefusedMessage("EXPORT_TRIGGER"));
      console.log(barrierRefusedRecord("EXPORT_TRIGGER"));
      log("capture.aborted", { reason: "no-operator-confirmation-export" });
      process.exitCode = 7;
      return;
    }
    await captureAndUpload(page, cfg, now);
  } finally {
    await ctx.close();
  }
}

void main();
