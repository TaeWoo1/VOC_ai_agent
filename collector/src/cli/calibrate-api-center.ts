/**
 * **Live, GATED, human-attended NAVER API-center MULTI-SURFACE selector calibrator (Phase A).**
 *
 *   set -a && . ./.env && set +a          # NAVER_API_CENTER_URL (operator-owned; never logged)
 *   npx tsx src/cli/calibrate-api-center.ts -- --i-understand-this-opens-live-naver
 *
 * Walks the FOUR `CALIBRATION_STAGES` (app_list, app_detail_anchor, api_group, credentials) in ONE session, in
 * ONE window, keeping the operator's login across every stage. At each stage the operator navigates to the
 * surface, hovers the target control and presses the calibration hotkey (default Ctrl+Shift+K), then signals
 * readiness with a per-stage sentinel file. The tool then reads a SANITIZED page signature and the STRUCTURAL
 * capture of the confirmed element, hands the capture to the FROZEN pure gate (`sanitizeCapture`), and advances.
 * `return_path` is NOT a stage — returning to SellerOps is a printed UI instruction, never a calibrated
 * selector, so it is excluded from `SELECTORS_CALIBRATED`.
 *
 * **Capture reliability — init-script + exposeBinding (the race-immune model).** The capture listener is
 * installed ONCE via `BrowserContext.addInitScript(buildCalibrationInitScript(...))`: Playwright auto-runs it
 * at the start of EVERY new document (navigation / reload / new tab) and in EVERY child frame, BEFORE the
 * page's own scripts — so a live listener is ALWAYS present after the operator navigates, with no Node-side
 * re-arm to race. Captures are pushed Node-ward through two `BrowserContext.exposeBinding` functions (a stage
 * pull + a capture push) that exist in every frame; Node validates host / active-tab / nonce / first-valid
 * and re-derives the frame category authoritatively before adopting anything. This RETIRES the prior polling
 * model — the per-tick `page.evaluate` re-arm and the `context.on("page")` / `page.on("load")` /
 * `framenavigated` event re-arm — under which (1) listeners armed before a navigation were destroyed (0
 * captures), (2) no re-arm happened DURING the blocking wait (0 captures), and (3) a per-tick re-arm
 * `page.evaluate` raced the navigation, destroyed the execution context, and crashed the process. No polling
 * `page.evaluate` can now race a navigation: the only remaining `page.evaluate` reads the SANITIZED census,
 * and it runs solely at settled checkpoints (stage start / on ready), never in a per-tick loop.
 *
 * It NEVER logs in, clicks, types, submits, creates, selects, autofills, or reads any field VALUE (incl.
 * Client ID / Secret). Operator navigation is the operator's OWN clicks — OBSERVED read-only in the init
 * script, never generated or blocked. The RAW capture (with real selectors) is written ONLY to the gitignored
 * `.calibration/` sink; the console/log gets ONLY the sanitized `summarize(...)` output (target kind +
 * structural hash + match count + resolution + page signatures) plus sanitized counts — never a raw selector,
 * value, or URL (a URL is reduced to a host category before launch).
 *
 * Gating mirrors `observe-api-center` / `run-api-issuance-live-naver`: refuses without
 * `--i-understand-this-opens-live-naver` (`hasLiveRunApproval`); `screenApiCenterUrl`-fail-closed BEFORE Chrome
 * launches; always `ctx.close()`. `main()` runs ONLY when invoked directly (inert on import), so offline
 * build/verify launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { OPERATOR_CONFIRM_BUTTON_LABEL, type OperatorConfirmAsk } from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";
import {
  EXTRACT_API_CENTER_CENSUS,
  observeFrom,
  screenApiCenterUrl,
  type ApiCenterStructuralCensus,
  type ApiCenterUrlCategory,
} from "./observe-api-center";
import {
  CALIBRATION_STAGES,
  pageSignature,
  sanitizeCapture,
  stageIsOptional,
  stageTargetKind,
  summarize,
  type CalibrationStage,
  type CalibrationSummary,
  type CalibrationTargetKind,
  type PageSignature,
  type RawArtifactEntry,
  type RawTargetCapture,
  type SanitizedTargetCandidate,
} from "../action-window/api-issuance-calibration/calibration";
import {
  buildCalibrationInitScript,
  CAL_CAPTURE_BINDING,
  CAL_STAGE_BINDING,
  CAPTURE_REQUIRED_TOAST,
  DEFAULT_CALIBRATION_HOTKEY,
  DEFAULT_CALIBRATION_HOTKEY_LABEL,
} from "../action-window/api-issuance-calibration/calibration-inpage";
import {
  createCaptureChannel,
  type CaptureRecord,
} from "../action-window/api-issuance-calibration/calibration-binding";
import { CANDIDATE_APP_ENTRY_SELECTOR } from "../action-window/naver-issuance-driver";
import { isSafeCalibrationArtifactPath } from "./approval-manifest";

/** A per-checkpoint operator signal: proceed, skip an optional stage, abort the session, or the wait timed out. */
export type CalibrationCheckpointSignal = "ready" | "skip" | "abort" | "timeout";

/** Count candidate application-entry rows — a COUNT only, never a name/id/value (reuses the canonical selector). */
const IN_PAGE_APP_ENTRY_COUNT = `(function () {
  /* cal-appcount */
  return document.querySelectorAll(${JSON.stringify(CANDIDATE_APP_ENTRY_SELECTOR)}).length;
})()`;

/** Injected seams so the whole multi-checkpoint walk is unit-tested offline over fakes (no browser/binding). */
export interface CalibrationSessionDeps {
  urlCategory: ApiCenterUrlCategory;
  /** Sanitized structural census of the CURRENT (newest) page (settled checkpoint read). */
  readCensus(): Promise<ApiCenterStructuralCensus>;
  /** CANDIDATE app-entry row count (existing-vs-empty branch); counts only. */
  readAppEntryCount(): Promise<number>;
  /** Mint a fresh per-stage nonce (binds a capture to exactly this stage; a late capture for a prior nonce is dropped). */
  mintNonce(): string;
  /** Tell the capture channel the current stage (so a hotkey during the stage is adoptable). */
  setActiveStage(nonce: string, kind: CalibrationTargetKind): void;
  /** Clear the current stage once it resolves (so a late hotkey for the finished stage finds none). */
  clearActiveStage(): void;
  /** Drain the binding-collected capture for a nonce (null when nothing was captured). */
  takeCaptureFor(nonce: string): CaptureRecord | null;
  /**
   * Block until the operator signals this stage ready / skip / abort / times out. Sentinel-file-only — it
   * runs NO `page.evaluate` and needs NO re-arm callback: the init-script listener survives every navigation,
   * so there is nothing to re-install while we wait.
   */
  waitForStageSentinel(stage: CalibrationStage): Promise<CalibrationCheckpointSignal>;
  /** Render the value-free "capture required, try again" toast on the newest page (production only). */
  notifyCaptureRequired?(): Promise<void>;
  /** Print sanitized per-stage instructions (noop in tests). */
  announceStage?(stage: CalibrationStage, targetKind: CalibrationTargetKind, optional: boolean): void;
  /** Announce that a REQUIRED stage got a capture-less ready and must be retried (noop in tests). */
  announceCaptureRequired?(stage: CalibrationStage): void;
  /** Announce that an OPTIONAL stage needs an explicit capture-or-skip (a bare ready never advances it). */
  announceSkippable?(stage: CalibrationStage): void;
}

export interface CalibrationSessionResult {
  summary: CalibrationSummary;
  /** RAW selectors — written ONLY to the gitignored sink, NEVER logged. */
  rawEntries: RawArtifactEntry[];
  /** True only on an explicit operator abort (SIGINT / `.abort` sentinel). */
  aborted: boolean;
  /** How many stages were walked (sanitized count). */
  stagesCompleted: number;
  /** How many operator navigation clicks were observed via captures (sanitized count). */
  clicksObserved: number;
  /** How many captures were collected + sanitized across the walk (sanitized count). */
  capturesCollected: number;
  /** How many capture-less READY signals were refused on a required stage (sanitized count). */
  captureRequiredCount: number;
  /** How many OPTIONAL stages were advanced by an explicit skip (no capture) (sanitized count). */
  skippedCount: number;
  /** How many adopted captures came from the TOP frame (sanitized count). */
  topFrameCaptures: number;
  /** How many adopted captures came from a CHILD frame (sanitized count). */
  childFrameCaptures: number;
}

/**
 * The pure multi-checkpoint orchestrator. Walks the four stages in ONE session; at each it mints a nonce, sets
 * the active stage on the capture channel, waits for the operator (sentinel-file only), reads the sanitized
 * page signature, and (when a capture was pushed for this stage's nonce) sanitizes the structural capture
 * through the FROZEN gate.
 *
 * A REQUIRED stage does NOT advance on a capture-less ready — it surfaces `CAPTURE_REQUIRED`, re-instructs, and
 * keeps waiting. An OPTIONAL stage (only `app_detail_anchor`) advances on an explicit skip only — never on a
 * bare capture-less ready — and always contributes its page signature. `clearActiveStage()` runs once the
 * stage resolves, so a late hotkey for the finished stage finds no active stage and is dropped. Abort/timeout
 * stop the walk and return the partial sanitized summary gathered so far. It never navigates, clicks, types,
 * or reads a value — those are the injected seams / the init script, each of which is value-free.
 */
export async function runCalibrationSession(deps: CalibrationSessionDeps): Promise<CalibrationSessionResult> {
  const pages: PageSignature[] = [];
  const targets: SanitizedTargetCandidate[] = [];
  const rawEntries: RawArtifactEntry[] = [];
  let aborted = false;
  let hasExistingApp = false;
  let stagesCompleted = 0;
  let clicksObserved = 0;
  let capturesCollected = 0;
  let captureRequiredCount = 0;
  let skippedCount = 0;
  let topFrameCaptures = 0;
  let childFrameCaptures = 0;

  for (const stage of CALIBRATION_STAGES) {
    const optional = stageIsOptional(stage);
    const nonce = deps.mintNonce();

    // The existing-vs-empty branch is decided on the app-list surface (the entry page IS the app list) and
    // carried forward. Read it at stage start (settled) so the ack toast names open_app vs create_app.
    if (stage === "app_list") {
      hasExistingApp = (await deps.readAppEntryCount()) > 0;
    }
    const targetKind = stageTargetKind(stage, hasExistingApp);
    deps.setActiveStage(nonce, targetKind);
    deps.announceStage?.(stage, targetKind, optional);

    // Wait for a definitive advance: a capture-backed ready, an explicit skip (optional only), abort, or timeout.
    let outcome: "advance_capture" | "advance_skip" | "abort" | "timeout" = "timeout";
    let captured: CaptureRecord | null = null;
    let waiting = true;
    while (waiting) {
      const signal = await deps.waitForStageSentinel(stage);
      if (signal === "abort") {
        outcome = "abort";
        waiting = false;
      } else if (signal === "timeout") {
        outcome = "timeout";
        waiting = false;
      } else if (signal === "skip") {
        if (optional) {
          outcome = "advance_skip";
          waiting = false;
        } else {
          // A required stage cannot be skipped — treat like a capture-less ready.
          captureRequiredCount += 1;
          deps.announceCaptureRequired?.(stage);
          await deps.notifyCaptureRequired?.();
        }
      } else {
        // signal === "ready"
        captured = deps.takeCaptureFor(nonce);
        if (captured) {
          outcome = "advance_capture";
          waiting = false;
        } else if (optional) {
          // A bare capture-less ready never advances an optional stage: capture the anchor or explicitly skip.
          deps.announceSkippable?.(stage);
        } else {
          captureRequiredCount += 1;
          deps.announceCaptureRequired?.(stage);
          await deps.notifyCaptureRequired?.();
        }
      }
    }

    // Resolve the stage: a late hotkey for the finished stage now finds no active stage (dropped).
    deps.clearActiveStage();

    if (outcome === "abort") {
      aborted = true;
      break;
    }
    if (outcome === "timeout") break;

    // Advanced (by capture or skip): the sanitized page signature is ALWAYS collected for the surface.
    const census = await deps.readCensus();
    const obs = observeFrom(deps.urlCategory, census);
    pages.push(pageSignature(stage, obs.pageCategory, obs.signals));

    if (outcome === "advance_skip") {
      skippedCount += 1;
    } else if (captured) {
      const raw: RawTargetCapture = { ...captured.raw, targetKind };
      const { sanitized, raw: rawEntry } = sanitizeCapture(raw);
      targets.push(sanitized);
      if (rawEntry) rawEntries.push(rawEntry);
      capturesCollected += 1;
      if (captured.operatorClickObserved) clicksObserved += 1;
      if (captured.frameCategory === "top") topFrameCaptures += 1;
      else childFrameCaptures += 1;
    }

    stagesCompleted += 1;
  }

  return {
    summary: summarize(pages, targets),
    rawEntries,
    aborted,
    stagesCompleted,
    clicksObserved,
    capturesCollected,
    captureRequiredCount,
    skippedCount,
    topFrameCaptures,
    childFrameCaptures,
  };
}

/* ────────────────────────────── page-bound seams (string-form evaluate) ────────────────────────────── */

/** Evaluate a STRING snippet (not a function) so esbuild's `__name` shim is never referenced in the page. */
function evalStr<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

/**
 * A safe, all-false census — the fallback when a page read races a navigation. Keeps the run alive (the stage
 * still gets a page signature, the next stage retries) instead of letting the rejection crash the process.
 */
const EMPTY_CENSUS: ApiCenterStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCount: 0,
  editableTextInputCount: 0,
  readonlyFieldCount: 0,
  listLikeContainerCount: 0,
};

/**
 * Build the page-bound subset of the deps over a getter for the ACTIVE (newest) page — the operator may open
 * the next stage in a new tab, so reads always target the newest tab (mirrors `observe-api-center`). Only the
 * SANITIZED census reads + the value-free capture-required toast live here now; capture itself is init-script
 * + exposeBinding driven (no page-side arm/read seams), so there is no `page.evaluate` in any polling loop.
 * Pure of the sentinel wait + instructions, so a fake page can drive these census seams.
 */
export function buildPageSessionDeps(
  getActivePage: () => Page,
  urlCategory: ApiCenterUrlCategory,
): Pick<CalibrationSessionDeps, "urlCategory" | "readCensus" | "readAppEntryCount" | "notifyCaptureRequired"> {
  // CRITICAL (live-only): the operator navigates freely, so a census `page.evaluate` at a checkpoint can still
  // race a late navigation and reject with "Execution context was destroyed" / "Target closed" / a detached
  // frame. These are best-effort read-only reads — a race must NEVER crash the session. `safeEval`/`safeVoid`
  // swallow the transient error and return a safe fallback; the next stage read retries on the settled page.
  // Log the FIRST swallowed eval error once (sanitized — error NAME only, never its message, which could carry
  // a URL/selector), so a persistent (non-transient) failure is observable instead of fully silent.
  let evalErrorLogged = false;
  const noteSwallowed = (e: unknown): void => {
    if (evalErrorLogged) return;
    evalErrorLogged = true;
    log("apiCenter.calibrate.eval_swallowed", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
  };
  const safeEval = async <R>(script: string, fallback: R): Promise<R> => {
    try {
      return await evalStr<R>(getActivePage(), script);
    } catch (e) {
      noteSwallowed(e);
      return fallback;
    }
  };
  const safeVoid = async (script: string): Promise<void> => {
    try {
      await evalStr(getActivePage(), script);
    } catch (e) {
      noteSwallowed(e); // transient navigation race — best-effort; the next checkpoint retries
    }
  };

  return {
    urlCategory,
    readCensus: () => safeEval<ApiCenterStructuralCensus>(EXTRACT_API_CENTER_CENSUS, EMPTY_CENSUS),
    readAppEntryCount: () => safeEval<number>(IN_PAGE_APP_ENTRY_COUNT, 0),
    notifyCaptureRequired: () => safeVoid(CAPTURE_REQUIRED_TOAST),
  };
}

/* ────────────────────────────── gitignored artifact path (sanitized/raw split) ────────────────────────────── */

const COLLECTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Repo-relative calibration artifact path for a run (the `.calibration/` dir is gitignored). */
export function calibrationArtifactRelPath(runId: string): string {
  return `.calibration/api-center-${runId}.json`;
}

/** Absolute path of the gitignored raw artifact for a run (under the collector tree). */
export function calibrationArtifactAbsPath(runId: string): string {
  return resolve(COLLECTOR_ROOT, ".calibration", `api-center-${runId}.json`);
}

/* ────────────────────────────── the operator's per-stage checkpoint ────────────────────────────── */

/**
 * **There is no readiness sentinel and no skip sentinel.** Both ADVANCED a stage — `.ready` with a capture and
 * `.skip` without one — and a file any process can `touch` cannot be evidence that a human looked at a screen.
 * Skipping is a second ANSWER to the same ask, so it is a second button on the same verified surface rather
 * than a file beside it (`./operator-confirm`).
 *
 * The abort sentinel stays: a forged abort ends a session, which is the safe direction.
 */
export const CALIBRATION_ABORT_FILENAME = "calibrate-api-center.abort";

export function calibrationAbortPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), CALIBRATION_ABORT_FILENAME);
}

/** The label on the second button, offered only for a stage that may honestly be skipped. */
export const CALIBRATION_SKIP_BUTTON_LABEL = "이 단계 건너뛰기";

/** One stage's ask, in the operator's own words. Built per stage so the press belongs to that stage. */
export function stageAskFor(
  stage: CalibrationStage,
  targetKind: CalibrationTargetKind,
  optional: boolean,
): OperatorConfirmAsk {
  return {
    title: `CALIBRATION — ${stage}`,
    headline: `${stage} 화면으로 직접 이동하신 뒤, 대상을 캡처하고 확인해 주세요.`,
    lines: [
      `대상: ${targetKind}${optional ? " (선택 단계)" : ""}`,
      "열린 전용 Chrome 창에서 직접 이동하세요 — SellerOps는 그 창을 조작하지 않습니다.",
      `대상 위에 마우스를 올리고 ${DEFAULT_CALIBRATION_HOTKEY_LABEL} 를 누르면 페이지에 캡처 안내가 뜹니다`,
      "(대상 종류 · 매칭 개수 · 해석 여부만 표시되며, 값은 절대 표시되지 않습니다).",
      "자격 증명 입력란은 위치만 캡처되고 값은 읽지 않습니다.",
      ...(optional
        ? [
            "",
            `이 단계는 선택입니다 — 캡처 없이 넘어가려면 [${CALIBRATION_SKIP_BUTTON_LABEL}] 를 누르세요.`,
            "캡처 없이 '현재 화면 확인'만 누르면 선택 단계는 진행되지 않습니다.",
          ]
        : []),
    ],
    ...(optional ? { secondary: { label: CALIBRATION_SKIP_BUTTON_LABEL } } : {}),
  };
}

/* ────────────────────────────── live wiring (inert on import) ────────────────────────────── */

const SENTINEL_POLL_MS = 1_000;
const STAGE_WAIT_TIMEOUT_MS = 20 * 60_000; // generous per-stage budget for a manual navigate + hover + hotkey
const HYDRATION_TIMEOUT_MS = 15_000;

function mintRunId(): string {
  return `cal_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function mintNonce(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

async function settle(page: Page): Promise<void> {
  const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
  if (typeof p.waitForLoadState !== "function") return;
  try {
    await p.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* timeout is fine — the classifier fails closed on thin signals */
  }
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER API-center MULTI-SURFACE calibration — explicit per-run approval required.");
  console.error(" Read-only calibration: the SELLER logs in and navigates each surface MANUALLY. This tool");
  console.error(" never logs in, clicks, types, submits, creates, selects, autofills, or reads any value");
  console.error(` (incl. Client ID/Secret). Per stage: navigate, hover the target and press ${DEFAULT_CALIBRATION_HOTKEY_LABEL},`);
  console.error(" then signal ready. RAW selectors go to the gitignored .calibration/ sink; only a SANITIZED");
  console.error(" summary (kind + hash + match count + resolution) is ever printed/logged. No URL/value saved.");
  console.error(line);
}

/**
 * Live entry (gated). NOT run during offline build/verify. Opens the window ONCE, keeps login across stages,
 * registers the init-script capture listener + the two exposeBinding channels BEFORE the first navigation (so
 * the listener is present in every document the operator reaches), writes the RAW artifact to the gitignored
 * sink, prints ONLY the sanitized summary, and always closes.
 */
async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasLiveRunApproval(args)) {
    console.error(approvalRequiredMessage());
    process.exit(3);
    return;
  }
  const url = process.env.NAVER_API_CENTER_URL;
  if (!url) {
    console.error("Set NAVER_API_CENTER_URL (operator-owned; never logged) to the API-center page first.");
    process.exit(2);
    return;
  }
  const screen = screenApiCenterUrl(url);
  if (!screen.ok) {
    console.error(
      `Refusing to launch: NAVER_API_CENTER_URL failed screening (reason=${screen.reason}). It must be the ` +
        "NAVER API-center or auth host and not a placeholder. No browser launched.",
    );
    process.exit(2);
    return;
  }
  const urlCategory = screen.urlCategory;
  const cfg = loadConfig();
  const runId = mintRunId();

  // Honor the manifest's declared raw-artifact path (SELLEROPS_CALIBRATION_ARTIFACT) so the path the operator
  // approved IS the path written — re-validated fail-closed here (defense in depth) with the SAME gate the
  // approval manifest used. Absent ⇒ the internally-minted default. Never outside the gitignored .calibration/.
  const declaredArtifactRel = process.env.SELLEROPS_CALIBRATION_ARTIFACT;
  if (declaredArtifactRel !== undefined && !isSafeCalibrationArtifactPath(declaredArtifactRel)) {
    console.error("Refusing to launch: SELLEROPS_CALIBRATION_ARTIFACT is not a safe gitignored .calibration/ path. No browser launched.");
    process.exit(2);
    return;
  }
  const artifactRel = declaredArtifactRel ?? calibrationArtifactRelPath(runId);
  const abortPath = calibrationAbortPathFor(cfg.statusFile);
  mkdirSync(dirname(abortPath), { recursive: true });
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => abortFlag.v || existsSync(abortPath),
    abortPath,
    timeoutMs: STAGE_WAIT_TIMEOUT_MS,
  });
  // The NEWEST tab, from a list the confirmation surface is filtered out of. Unfiltered this would resolve to
  // the blank SellerOps page the moment it opened — every census read there, and the capture channel's
  // `isActivePage` check would reject the operator's real captures as coming from an inactive tab.
  const activePage = (): Page => {
    const list = confirmHost.contextLike.pages() as unknown as Page[];
    return (list[list.length - 1] ?? list[0]) as Page;
  };

  const base = buildPageSessionDeps(activePage, urlCategory);

  // The capture channel Node-validates every pushed capture (host / active-tab / nonce / first-valid) and
  // re-derives the frame category authoritatively. `isActivePage` accepts a capture only from the newest tab.
  const channel = createCaptureChannel({ urlCategory, isActivePage: (p) => p === activePage() });

  // Register the capture channel + the init-script listener BEFORE the first navigation. Playwright re-runs
  // the init script in every subsequent document/frame (nav / reload / new tab / child frame) automatically,
  // so no Node-side re-arm exists to race the operator's navigation. exposeBinding installs both `window`
  // functions in every frame; the stage binding ignores its source arg and returns the current stage, the
  // capture binding forwards `source` (with `.frame` / `.page`) so Node can validate + re-derive frame origin.
  await ctx.exposeBinding(CAL_STAGE_BINDING, () => channel.onStageQuery());
  await ctx.exposeBinding(CAL_CAPTURE_BINDING, (source, payload: unknown) => channel.onCapture(source, payload));
  await ctx.addInitScript(buildCalibrationInitScript(DEFAULT_CALIBRATION_HOTKEY));

  // The operator navigates to the API-center once; the SAME window/login is reused across every stage.
  const entry = activePage();
  if (entry) await entry.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);

  /** The ask for the stage now in flight, built when the session announces it. */
  let stageAsk: OperatorConfirmAsk = stageAskFor(CALIBRATION_STAGES[0]!, "create_app", false);
  const deps: CalibrationSessionDeps = {
    ...base,
    readCensus: async () => {
      await settle(activePage());
      return base.readCensus();
    },
    mintNonce,
    setActiveStage: (nonce, kind) => channel.setActiveStage(nonce, kind),
    clearActiveStage: () => channel.clearActiveStage(),
    takeCaptureFor: (nonce) => channel.takeCaptureFor(nonce),
    // A FRESH confirmation per stage; the wait polls ONLY the confirmation tab, so nothing here can race the
    // operator's navigation of their own page. The init-script listener survives every navigation, so there is
    // nothing to re-arm mid-wait either.
    waitForStageSentinel: async (_stage) => {
      const confirmation = await confirmHost.confirm(stageAsk);
      if (confirmation.signal !== "ready") return confirmation.signal;
      return confirmation.choice === "secondary" ? "skip" : "ready";
    },
    announceStage: (stage, targetKind, optional) => {
      stageAsk = stageAskFor(stage, targetKind, optional);
      confirmHost.announce(stageAsk);
    },
    announceCaptureRequired: (stage) => {
      console.error("");
      console.error(`Stage ${stage} is REQUIRED but no target was captured — not advancing.`);
      console.error(`Hover the target and press ${DEFAULT_CALIBRATION_HOTKEY_LABEL} (watch for the on-page toast),`);
      console.error(`then press [${OPERATOR_CONFIRM_BUTTON_LABEL}] again. Polling…`);
    },
    announceSkippable: (stage) => {
      console.error("");
      console.error(`Stage ${stage} is OPTIONAL and nothing was captured — a bare ready does not advance it.`);
      console.error(
        `Either capture the anchor and press [${OPERATOR_CONFIRM_BUTTON_LABEL}], or press [${CALIBRATION_SKIP_BUTTON_LABEL}]. Polling…`,
      );
    },
  };

  try {
    const result = await runCalibrationSession(deps);

    // Returning to SellerOps is a plain UI instruction — NOT a calibrated selector, NOT in the artifact.
    console.error("");
    console.error("Calibration walk complete. 이제 SellerOps 탭으로 직접 돌아가세요.");

    // RAW artifact → gitignored sink ONLY (the declared/approved path). Selectors never touch the console/log.
    const artifactPath = resolve(COLLECTOR_ROOT, artifactRel);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({ runId, calibrationPending: true, entries: result.rawEntries }, null, 2),
      "utf8",
    );

    // SANITIZED summary → console/log. No selector/value/URL (host category only).
    console.log(
      JSON.stringify(
        {
          runId,
          urlCategory,
          aborted: result.aborted,
          stagesCompleted: result.stagesCompleted,
          capturesCollected: result.capturesCollected,
          captureRequiredCount: result.captureRequiredCount,
          skippedCount: result.skippedCount,
          clicksObserved: result.clicksObserved,
          topFrameCaptures: result.topFrameCaptures,
          childFrameCaptures: result.childFrameCaptures,
          resolvedCount: result.summary.resolvedCount,
          unresolvedCount: result.summary.unresolvedCount,
          rawArtifact: artifactRel,
          summary: result.summary,
        },
        null,
        2,
      ),
    );
    log("apiCenter.calibrate.done", {
      runId,
      urlCategory,
      aborted: result.aborted,
      stagesCompleted: result.stagesCompleted,
      capturesCollected: result.capturesCollected,
      captureRequiredCount: result.captureRequiredCount,
      skippedCount: result.skippedCount,
      clicksObserved: result.clicksObserved,
      topFrameCaptures: result.topFrameCaptures,
      childFrameCaptures: result.childFrameCaptures,
      resolvedCount: result.summary.resolvedCount,
      unresolvedCount: result.summary.unresolvedCount,
    });
  } finally {
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing. A
// top-level catch guarantees a stray rejection is logged (sanitized — name only) and exits cleanly instead
// of surfacing as an uncaughtException; main()'s own `finally` has already closed the context.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("apiCenter.calibrate.fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
