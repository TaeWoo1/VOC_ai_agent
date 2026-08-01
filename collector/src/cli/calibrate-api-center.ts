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
 * **Capture reliability (v2 fix).** The in-page capture listeners live in the page's JS realm, so a navigation
 * / reload / new-tab (a fresh document) destroys them — the live regression (attempt #2) was: listeners armed
 * once at stage START, the operator then navigated (a real top-level path change) DURING the blocking sentinel
 * wait, and the later hotkey had no listener so ZERO targets were captured. The event-driven hooks
 * (`context.on("page")` / `page.on("load")` / `page.on("framenavigated")`) did NOT fire for that navigation in
 * the real browser. The reliable mechanism is now a PER-TICK re-arm: the sentinel wait invokes an `onTick`
 * callback on EVERY poll iteration (~1s) that re-arms + re-injects the target kind on the NEWEST page, so a
 * navigation done at any point during the wait is followed by a re-arm within one tick. It is idempotent (only
 * a page reporting NOT-armed via `IS_CAPTURE_ARMED` is re-armed, so a live document is never double-armed). The
 * event hooks STAY as a best-effort supplement. A successful hotkey capture renders a value-free ack toast
 * (kind + match count + resolved).
 *
 * It NEVER logs in, clicks, types, submits, creates, selects, autofills, or reads any field VALUE (incl.
 * Client ID / Secret). Operator navigation is the operator's OWN clicks — OBSERVED read-only via
 * `READ_CLICK_OBSERVED`, never generated or blocked. The RAW capture (with real selectors) is written ONLY to
 * the gitignored `.calibration/` sink; the console/log gets ONLY the sanitized `summarize(...)` output (target
 * kind + structural hash + match count + resolution + confidence + page signatures) plus sanitized counts —
 * never a raw selector, value, or URL (a URL is reduced to a host category before launch).
 *
 * Gating mirrors `observe-api-center` / `run-api-issuance-live-naver`: refuses without
 * `--i-understand-this-opens-live-naver` (`hasLiveRunApproval`); `screenApiCenterUrl`-fail-closed BEFORE Chrome
 * launches; always `ctx.close()`. `main()` runs ONLY when invoked directly (inert on import), so offline
 * build/verify launches nothing.
 */
import type { Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import {
  classifyUrlCategory,
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
  ARM_CALIBRATION_CAPTURE,
  buildSetTargetKind,
  CAPTURE_REQUIRED_TOAST,
  DEFAULT_CALIBRATION_HOTKEY_LABEL,
  IS_CAPTURE_ARMED,
  READ_CAPTURED_TARGET,
  READ_CLICK_OBSERVED,
  RESET_CAPTURE,
} from "../action-window/api-issuance-calibration/calibration-inpage";
import { CANDIDATE_APP_ENTRY_SELECTOR } from "../action-window/naver-issuance-driver";
import { isSafeCalibrationArtifactPath } from "./approval-manifest";

/** The structural capture the in-page READ script returns — everything except the stage-attached `targetKind`. */
export type RawCapturedShape = Omit<RawTargetCapture, "targetKind">;

/** A per-checkpoint operator signal: proceed, skip an optional stage, abort the session, or the wait timed out. */
export type CalibrationCheckpointSignal = "ready" | "skip" | "abort" | "timeout";

/** Count candidate application-entry rows — a COUNT only, never a name/id/value (reuses the canonical selector). */
const IN_PAGE_APP_ENTRY_COUNT = `(function () {
  /* cal-appcount */
  return document.querySelectorAll(${JSON.stringify(CANDIDATE_APP_ENTRY_SELECTOR)}).length;
})()`;

/** Injected seams so the whole multi-checkpoint walk is unit-tested offline over a fake page. */
export interface CalibrationSessionDeps {
  urlCategory: ApiCenterUrlCategory;
  /** Sanitized structural census of the CURRENT (newest) page. */
  readCensus(): Promise<ApiCenterStructuralCensus>;
  /** CANDIDATE app-entry row count (existing-vs-empty branch); counts only. */
  readAppEntryCount(): Promise<number>;
  /**
   * RE-ARM the read-only capture listeners on the NEWEST page — but ONLY when that page reports NOT armed (a
   * fresh document). Idempotent: a live document is never double-armed. This is the reliability fix — a
   * navigation / new-tab destroys the prior document's listeners, so capture must be re-installed on the new one.
   */
  armCaptureOnNewestPage(): Promise<void>;
  /** Whether the NEWEST page currently has capture listeners installed (the CAPTURE_ARMED state). */
  readCaptureArmed(): Promise<boolean>;
  /** Inject the current stage's target KIND (closed-vocab enum) so the ack toast can name it. Value-free. */
  setTargetKind(kind: CalibrationTargetKind): Promise<void>;
  /** Clear the calibration window vars before a checkpoint. */
  resetCapture(): Promise<void>;
  /** Read the structural capture of the hotkey-confirmed element (null when nothing was confirmed). */
  readCapturedTarget(): Promise<RawCapturedShape | null>;
  /** Whether the operator's own navigation click was observed since the last read. */
  readClickObserved(): Promise<boolean>;
  /** Render the value-free "capture required, try again" toast on the newest page (production only). */
  notifyCaptureRequired?(): Promise<void>;
  /**
   * Block until the operator signals this stage ready / skip / abort / times out, invoking `onTick` on EVERY
   * poll iteration. `onTick` re-arms capture + re-injects the target kind on the NEWEST page, so a navigation
   * the operator performs DURING the wait is followed by a re-arm within ~1 poll tick — the hotkey then lands
   * on a document that still has the listener. This per-tick re-arm (not the event hooks, which proved
   * unreliable live) is the reliability mechanism.
   */
  waitForStageSentinel(
    stage: CalibrationStage,
    onTick: () => Promise<void>,
  ): Promise<CalibrationCheckpointSignal>;
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
  /** How many operator navigation clicks were observed (sanitized count). */
  clicksObserved: number;
  /** How many stages had capture listeners confirmed armed on the newest page (the CAPTURE_ARMED state). */
  stagesArmed: number;
  /** How many capture-less READY signals were refused on a required stage (sanitized count). */
  captureRequiredCount: number;
  /** How many OPTIONAL stages were advanced by an explicit skip (no capture) (sanitized count). */
  skippedCount: number;
}

/**
 * The pure multi-checkpoint orchestrator. Walks the four stages in ONE session; at each it (re-)arms capture on
 * the newest page, injects the target kind, waits for the operator, reads the sanitized page signature, and
 * (when the operator confirmed a control) sanitizes the structural capture through the FROZEN gate.
 *
 * A REQUIRED stage does NOT advance on a capture-less ready — it surfaces `CAPTURE_REQUIRED`, re-instructs, and
 * keeps waiting (the re-arm stays live). An OPTIONAL stage (only `app_detail_anchor`) advances on an explicit
 * skip only — never on a bare capture-less ready — and always contributes its page signature. Abort/timeout
 * stop the walk and return the partial sanitized summary gathered so far. It never navigates, clicks, types, or
 * reads a value — those are the injected page seams, each of which is value-free.
 */
export async function runCalibrationSession(deps: CalibrationSessionDeps): Promise<CalibrationSessionResult> {
  const pages: PageSignature[] = [];
  const targets: SanitizedTargetCandidate[] = [];
  const rawEntries: RawArtifactEntry[] = [];
  let aborted = false;
  let hasExistingApp = false;
  let stagesCompleted = 0;
  let clicksObserved = 0;
  let stagesArmed = 0;
  let captureRequiredCount = 0;
  let skippedCount = 0;

  for (const stage of CALIBRATION_STAGES) {
    const optional = stageIsOptional(stage);
    await deps.resetCapture();
    await deps.armCaptureOnNewestPage();
    if (await deps.readCaptureArmed()) stagesArmed += 1;

    // The existing-vs-empty branch is decided on the app-list surface (the entry page IS the app list) and
    // carried forward. Read it before injecting the kind so the ack toast names open_app vs create_app.
    if (stage === "app_list") {
      hasExistingApp = (await deps.readAppEntryCount()) > 0;
    }
    const targetKind = stageTargetKind(stage, hasExistingApp);
    await deps.setTargetKind(targetKind);
    deps.announceStage?.(stage, targetKind, optional);

    // Wait for a definitive advance: a capture-backed ready, an explicit skip (optional only), abort, or timeout.
    let outcome: "advance_capture" | "advance_skip" | "abort" | "timeout" = "timeout";
    let captured: RawCapturedShape | null = null;
    let waiting = true;
    while (waiting) {
      // Pre-wait re-arm (idempotent): a fresh document reached before the wait must be armed before the hotkey.
      await deps.armCaptureOnNewestPage();
      await deps.setTargetKind(targetKind);

      // Per-tick re-arm (the reliability fix): the wait invokes this on EVERY poll iteration, so a navigation
      // the operator does DURING the blocking wait is followed by a re-arm within ~1 tick — the hotkey lands
      // on a live-listener document. Idempotent via IS_CAPTURE_ARMED, so a still-live document is not re-armed.
      const signal = await deps.waitForStageSentinel(stage, async () => {
        await deps.armCaptureOnNewestPage();
        await deps.setTargetKind(targetKind);
      });
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
        captured = await deps.readCapturedTarget();
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
      const raw: RawTargetCapture = { ...captured, targetKind };
      const { sanitized, raw: rawEntry } = sanitizeCapture(raw);
      targets.push(sanitized);
      if (rawEntry) rawEntries.push(rawEntry);
    }

    if (await deps.readClickObserved()) clicksObserved += 1;
    stagesCompleted += 1;
  }

  return {
    summary: summarize(pages, targets),
    rawEntries,
    aborted,
    stagesCompleted,
    clicksObserved,
    stagesArmed,
    captureRequiredCount,
    skippedCount,
  };
}

/* ────────────────────────────── page-bound seams (string-form evaluate) ────────────────────────────── */

/** Evaluate a STRING snippet (not a function) so esbuild's `__name` shim is never referenced in the page. */
function evalStr<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

/**
 * Build the page-bound subset of the deps over a getter for the ACTIVE (newest) page — the operator may open
 * the next stage in a new tab, so reads (and the re-arm) always target the newest tab (mirrors
 * `observe-api-center`). The re-arm is idempotent: it reads `IS_CAPTURE_ARMED` first and only installs
 * listeners on a page that is NOT armed (a fresh document), so a live document is never double-armed. Pure of
 * the sentinel wait + instructions, so a fake page can drive the same seams (and exercise the idempotency).
 */
export function buildPageSessionDeps(
  getActivePage: () => Page,
  urlCategory: ApiCenterUrlCategory,
): Pick<
  CalibrationSessionDeps,
  | "urlCategory"
  | "readCensus"
  | "readAppEntryCount"
  | "armCaptureOnNewestPage"
  | "readCaptureArmed"
  | "setTargetKind"
  | "resetCapture"
  | "readCapturedTarget"
  | "readClickObserved"
  | "notifyCaptureRequired"
> {
  return {
    urlCategory,
    readCensus: () => evalStr<ApiCenterStructuralCensus>(getActivePage(), EXTRACT_API_CENTER_CENSUS),
    readAppEntryCount: () => evalStr<number>(getActivePage(), IN_PAGE_APP_ENTRY_COUNT),
    armCaptureOnNewestPage: async () => {
      const page = getActivePage();
      // Host-screen the re-arm: only install listeners on the API-center / auth host, never on an off-target
      // or popup tab the operator may open in the same dedicated context (pre-launch screening covers only the
      // entry URL). Reduces page.url() to a host category — the raw URL is never logged.
      let host: ApiCenterUrlCategory = "unknown";
      try {
        host = classifyUrlCategory(page.url());
      } catch {
        host = "unknown";
      }
      if (host !== "api_center_host" && host !== "naver_auth_host") return;
      const armed = await evalStr<boolean>(page, IS_CAPTURE_ARMED);
      if (!armed) await evalStr(page, ARM_CALIBRATION_CAPTURE);
    },
    readCaptureArmed: () => evalStr<boolean>(getActivePage(), IS_CAPTURE_ARMED),
    setTargetKind: async (kind) => {
      await evalStr(getActivePage(), buildSetTargetKind(kind));
    },
    resetCapture: async () => {
      await evalStr(getActivePage(), RESET_CAPTURE);
    },
    readCapturedTarget: () => evalStr<RawCapturedShape | null>(getActivePage(), READ_CAPTURED_TARGET),
    readClickObserved: () => evalStr<boolean>(getActivePage(), READ_CLICK_OBSERVED),
    notifyCaptureRequired: async () => {
      await evalStr(getActivePage(), CAPTURE_REQUIRED_TOAST);
    },
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

/* ────────────────────────────── sentinels (multi-checkpoint) ────────────────────────────── */

/** Per-stage readiness sentinel filename (cleared + re-polled every stage). */
export const CALIBRATION_SENTINEL_FILENAME = "calibrate-api-center.ready";
/** Per-stage SKIP sentinel filename (advances an OPTIONAL stage without a capture). */
export const CALIBRATION_SKIP_FILENAME = "calibrate-api-center.skip";
/** Operator abort sentinel filename (ends the session, writes the partial sanitized summary). */
export const CALIBRATION_ABORT_FILENAME = "calibrate-api-center.abort";

export function calibrationSentinelPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), CALIBRATION_SENTINEL_FILENAME);
}
export function calibrationSkipPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), CALIBRATION_SKIP_FILENAME);
}
export function calibrationAbortPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), CALIBRATION_ABORT_FILENAME);
}

/* ────────────────────────────── live wiring (inert on import) ────────────────────────────── */

const SENTINEL_POLL_MS = 1_000;
const STAGE_WAIT_TIMEOUT_MS = 20 * 60_000; // generous per-stage budget for a manual navigate + hover + hotkey
const HYDRATION_TIMEOUT_MS = 15_000;

function mintRunId(): string {
  return `cal_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

function printStageInstructions(
  stage: CalibrationStage,
  targetKind: CalibrationTargetKind,
  optional: boolean,
  readyPath: string,
  skipPath: string,
  abortPath: string,
): void {
  console.error("");
  console.error(`Calibration stage: ${stage} (target: ${targetKind}${optional ? ", optional" : ""}).`);
  console.error(`  1) Navigate MANUALLY to the ${stage} surface in the opened dedicated Chrome window.`);
  console.error(`  2) Hover the target and press ${DEFAULT_CALIBRATION_HOTKEY_LABEL} — an on-page toast confirms`);
  console.error("     the capture (target kind + match count + resolved/unresolved; no value is ever shown).");
  console.error("     A credential value field is captured by POSITION only — its value is never read.");
  console.error("  3) Signal readiness by creating this file (or say \"ready\"):");
  console.error(`       ${readyPath}`);
  if (optional) {
    console.error(`     This stage is OPTIONAL — to skip it WITHOUT a capture, create: ${skipPath}`);
    console.error('       (or say "skip"). A bare "ready" without a capture will NOT advance an optional stage.');
  }
  console.error(`     To abort the whole session, create: ${abortPath}  (or press Ctrl+C).`);
  console.error("  Polling…");
}

/**
 * Live entry (gated). NOT run during offline build/verify. Opens the window ONCE, keeps login across stages,
 * event-drives capture re-arm on the newest page, writes the RAW artifact to the gitignored sink, prints ONLY
 * the sanitized summary, and always closes.
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
  const readyPath = calibrationSentinelPathFor(cfg.statusFile);
  const skipPath = calibrationSkipPathFor(cfg.statusFile);
  const abortPath = calibrationAbortPathFor(cfg.statusFile);
  mkdirSync(dirname(readyPath), { recursive: true });
  removeSentinel(readyPath);
  removeSentinel(skipPath);
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const activePage = (): Page => {
    const list = ctx.pages();
    return (list[list.length - 1] ?? list[0]) as Page;
  };

  const base = buildPageSessionDeps(activePage, urlCategory);

  // The current stage's target kind, tracked so the event-driven re-arm can RE-INJECT it onto a fresh document
  // (a navigation / new-tab loses `window.__cal_target_kind__` along with the listeners).
  let currentStageKind: CalibrationTargetKind | null = null;

  // EVENT-DRIVEN RE-ARM (the reliability fix). A fresh document (navigation / reload / new-tab / top-frame
  // replacement) drops the in-page capture listeners; re-arm the NEWEST page whenever one appears, idempotently
  // (armCaptureOnNewestPage only installs on a page reporting NOT armed). Read-only — installs listeners only.
  const rearmNewest = async (): Promise<void> => {
    try {
      await base.armCaptureOnNewestPage();
      if (currentStageKind) await base.setTargetKind(currentStageKind);
    } catch {
      /* the page may be mid-navigation; the backstop re-arm on the next wait tick will catch it */
    }
  };
  const hookPage = (p: Page): void => {
    const evented = p as unknown as {
      on?: (event: string, cb: (arg?: unknown) => void) => void;
      mainFrame?: () => unknown;
    };
    if (typeof evented.on !== "function") return;
    evented.on("load", () => void rearmNewest());
    evented.on("framenavigated", (frame?: unknown) => {
      // Top-frame navigation only — a subframe navigation must not thrash the re-arm.
      if (!evented.mainFrame || frame === evented.mainFrame()) void rearmNewest();
    });
  };
  const eventedCtx = ctx as unknown as { on?: (event: string, cb: (p: Page) => void) => void };
  if (typeof eventedCtx.on === "function") {
    eventedCtx.on("page", (p: Page) => {
      hookPage(p);
      void rearmNewest();
    });
  }
  for (const p of ctx.pages()) hookPage(p);

  // The operator navigates to the API-center once; the SAME window/login is reused across every stage.
  const entry = activePage();
  if (entry) await entry.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);

  const deps: CalibrationSessionDeps = {
    ...base,
    readCensus: async () => {
      await settle(activePage());
      return base.readCensus();
    },
    // Track the current stage's kind so the event-driven re-arm can re-inject it after a navigation.
    setTargetKind: async (kind) => {
      currentStageKind = kind;
      await base.setTargetKind(kind);
    },
    waitForStageSentinel: async (_stage, onTick) => {
      removeSentinel(readyPath);
      removeSentinel(skipPath);
      const maxTicks = Math.ceil(STAGE_WAIT_TIMEOUT_MS / SENTINEL_POLL_MS);
      for (let i = 0; i < maxTicks; i++) {
        // Per-tick re-arm FIRST: if the operator navigated during the previous sleep, re-install the capture
        // listener on the newest document before we could read a ready set by a hotkey on the new surface.
        await onTick();
        if (abortFlag.v || existsSync(abortPath)) return "abort";
        if (existsSync(skipPath)) return "skip";
        if (existsSync(readyPath)) return "ready";
        await sleep(SENTINEL_POLL_MS);
      }
      return "timeout";
    },
    announceStage: (stage, targetKind, optional) =>
      printStageInstructions(stage, targetKind, optional, readyPath, skipPath, abortPath),
    announceCaptureRequired: (stage) => {
      console.error("");
      console.error(`Stage ${stage} is REQUIRED but no target was captured — not advancing.`);
      console.error(`Hover the target and press ${DEFAULT_CALIBRATION_HOTKEY_LABEL} (watch for the on-page toast),`);
      console.error("then signal ready again. Polling…");
    },
    announceSkippable: (stage) => {
      console.error("");
      console.error(`Stage ${stage} is OPTIONAL and nothing was captured — a bare ready does not advance it.`);
      console.error("Either capture the anchor and signal ready, or create the .skip sentinel to skip. Polling…");
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
          stagesArmed: result.stagesArmed,
          captureRequiredCount: result.captureRequiredCount,
          skippedCount: result.skippedCount,
          clicksObserved: result.clicksObserved,
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
      stagesArmed: result.stagesArmed,
      captureRequiredCount: result.captureRequiredCount,
      skippedCount: result.skippedCount,
      clicksObserved: result.clicksObserved,
      resolvedCount: result.summary.resolvedCount,
      unresolvedCount: result.summary.unresolvedCount,
    });
  } finally {
    removeSentinel(readyPath);
    removeSentinel(skipPath);
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
